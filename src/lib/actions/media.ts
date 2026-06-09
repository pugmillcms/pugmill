"use server";
import { revalidatePath } from "next/cache";
import path from "path";
import { db } from "@/lib/db";
import { media, posts } from "@/lib/db/schema";
import { eq, like, desc, notInArray, inArray, isNotNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/get-current-user";
import { hooks } from "@/lib/hooks";
import { loadPlugins } from "@/lib/plugin-loader";
import { auditLog } from "@/lib/audit-log";
import { getStorage } from "@/lib/storage";

// SVG is intentionally excluded: an .svg can carry inline <script>/event
// handlers, and files are served same-origin and inline from /uploads, so a
// stored SVG is a stored-XSS payload. Raster/video formats only. (If SVG
// support is ever needed, sanitize on upload AND serve it sandboxed.)
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4", "video/webm", "video/ogg",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".mp4", ".webm", ".ogv",
]);

// Most managed platforms cap request bodies around 4.5 MB — keep this below
// that ceiling so the Next.js layer returns a clear error instead of a silent
// 413 from infrastructure.
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB (leaves headroom for FormData envelope)

// Media is editable by any signed-in user (admin or editor), so this only
// asserts authentication — not the admin role. Named accordingly to avoid the
// false impression that it gates on admin.
async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export async function uploadMedia(formData: FormData) {
  const user = await requireUser();
  await loadPlugins();

  const file = formData.get("file") as File;
  if (!file || file.size === 0) return { error: "No file provided" };

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    return { error: `File too large. Maximum size is 4 MB (host platform limit).` };
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: `File type "${file.type}" is not allowed` };
  }

  // Validate extension (defence in depth)
  const originalExt = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(originalExt)) {
    return { error: `File extension "${originalExt}" is not allowed` };
  }

  // Sanitize filename: use only the allowlisted final extension, strip all dots from
  // the base name so double extensions like .php.jpg cannot be stored.
  const baseName = path.basename(file.name, originalExt)
    .replace(/[^a-zA-Z0-9_-]/g, "-") // replace dots and unsafe chars
    .replace(/-{2,}/g, "-")           // collapse multiple dashes
    .toLowerCase()
    .slice(0, 100)                    // cap length
    || "file";
  const safeName = `${baseName}${originalExt}`;

  const fileName = `${Date.now()}-${safeName}`;
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  // Delegate to the active StorageProvider (local or s3)
  let uploadResult;
  try {
    uploadResult = await getStorage().upload(buffer, fileName, file.type);
  } catch (err) {
    console.error("[media] upload failed:", err);
    // Surface the real error to the admin — this is a trusted, authenticated
    // surface and generic messages make storage misconfiguration impossible to
    // diagnose (wrong region, bad endpoint, missing bucket, etc.).
    const name = err instanceof Error ? err.name : "Error";
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Upload failed (${name}): ${message}` };
  }

  const newMedia = await db.insert(media).values({
    fileName,
    fileType: file.type,
    fileSize: file.size,
    url: uploadResult.url,
    storageKey: uploadResult.storageKey,
  } as typeof media.$inferInsert).returning();

  auditLog({ action: "media.upload", userId: user.id, resourceId: newMedia[0].id, detail: fileName });
  await hooks.doAction("media:after-upload", { file: newMedia[0] });
  revalidatePath("/admin/media");
  return { id: newMedia[0].id, url: uploadResult.url };
}

export async function getImageMedia(): Promise<{ id: number; url: string; fileName: string }[]> {
  await requireUser();
  const rows = await db.select({ id: media.id, url: media.url, fileName: media.fileName })
    .from(media)
    .where(like(media.fileType, "image/%"))
    .orderBy(desc(media.createdAt));
  return rows;
}

export async function deleteMedia(id: number) {
  const user = await requireUser();
  await loadPlugins();

  // Fetch the record so we can clean up the stored file
  const rows = await db.select().from(media).where(eq(media.id, id));
  const record = rows[0];

  if (record) {
    const keyToDelete = record.storageKey
      // Fallback: derive key from URL for records that predate the storageKey column
      ?? (record.url.startsWith("/") ? record.url.slice(1) : null);

    if (keyToDelete) {
      try {
        await getStorage().delete(keyToDelete);
      } catch (err) {
        // Log but don't block the DB deletion — orphaned files are recoverable;
        // a dangling DB record pointing to a missing file is harder to diagnose.
        console.error("[media] file deletion failed:", err);
      }
    }
  }

  await db.delete(media).where(eq(media.id, id));
  auditLog({ action: "media.delete", userId: user.id, resourceId: id });
  revalidatePath("/admin/media");
}

export async function updateMediaAltText(id: number, altText: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireUser();
    await db.update(media).set({ altText: altText.trim() || null } as Partial<typeof media.$inferInsert>).where(eq(media.id, id));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update alt text" };
  }
}

export async function cleanupUnusedMedia(): Promise<{ deleted: number }> {
  const user = await requireUser();

  // Subquery: all media IDs currently used as a featured image
  const usedIds = db
    .select({ id: posts.featuredImage })
    .from(posts)
    .where(isNotNull(posts.featuredImage));

  const unused = await db
    .select()
    .from(media)
    .where(notInArray(media.id, usedIds));

  const storage = getStorage();
  const deletedIds: number[] = [];

  // Delete files from storage per-item (errors are swallowed — orphan files
  // are preferable to leaving dangling DB records).
  for (const item of unused) {
    const keyToDelete = item.storageKey
      ?? (item.url.startsWith("/") ? item.url.slice(1) : null);
    if (keyToDelete) {
      try { await storage.delete(keyToDelete); } catch { /* orphan file — continue */ }
    }
    deletedIds.push(item.id);
    auditLog({ action: "media.delete", userId: user.id, resourceId: item.id });
  }

  // Batch-delete all processed records in a single query.
  if (deletedIds.length > 0) {
    await db.delete(media).where(inArray(media.id, deletedIds));
  }

  revalidatePath("/admin");
  revalidatePath("/admin/media");
  return { deleted: deletedIds.length };
}
