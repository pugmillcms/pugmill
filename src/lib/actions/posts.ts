"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { posts, postCategories, postTags } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/get-current-user";
import { hooks } from "@/lib/hooks";
import { loadPlugins } from "@/lib/plugin-loader";
import type { PostPayload } from "@/lib/hook-catalogue";
import { auditLog } from "@/lib/audit-log";
import { z } from "zod";
import { aeoSchema, parseAeoMetadata } from "@/lib/aeo";
import { pingIndexNow } from "@/lib/indexnow";

const postSchema = z.object({
  type: z.enum(["post", "page"]).default("post"),
  title: z.string().min(1, "Title is required").max(255),
  slug: z.string().max(255).regex(/^[a-z0-9-]*$/, "Slug can only contain lowercase letters, numbers, and hyphens").optional(),
  content: z.string().min(1, "Content is required").max(200000),
  excerpt: z.string().max(2000).optional(),
  publishAt: z.string().optional(),
  parentId: z.number().int().positive().nullable().optional(),
  aeoMetadata: aeoSchema,
  seoTitle: z.string().max(60).optional(),
  seoMetaDescription: z.string().max(155).optional(),
  robotsNoindex: z.boolean().default(false),
  robotsNofollow: z.boolean().default(false),
  canonicalUrl: z.string().optional(),
  ogImageUrl: z.string().optional(),
});

function resolvePublishState(
  publishAt?: string,
  intent?: string | null,
): { published: boolean; publishedAt: Date | null } {
  // Explicit draft intent — always save unpublished with no date
  if (intent === "draft") return { published: false, publishedAt: null };

  // No date supplied + publish intent → publish immediately
  if (!publishAt || publishAt.trim() === "") {
    if (intent === "publish") return { published: true, publishedAt: new Date() };
    return { published: false, publishedAt: null };
  }

  const date = new Date(publishAt);
  if (isNaN(date.getTime())) return { published: false, publishedAt: null };
  const published = date <= new Date();
  return { published, publishedAt: date };
}

/** Safely parse a FormData integer field — returns null for missing, empty, or non-finite values. */
function parseIntOrNull(value: FormDataEntryValue | string | null): number | null {
  if (!value) return null;
  const n = parseInt(value as string, 10);
  return Number.isFinite(n) ? n : null;
}

async function requireAdminOrEditor() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized: not logged in");
  if (user.role !== "admin" && user.role !== "editor") throw new Error("Unauthorized: insufficient role");
  return user;
}

/**
 * Editors may only set parentId to a post they authored.
 * Admins are unrestricted. Pass userId only when role === "editor".
 */
async function assertParentIdAuthorized(parentId: number | null, userId: string): Promise<void> {
  if (parentId === null) return;
  const parent = await db.select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, parentId));
  if (!parent[0] || parent[0].authorId !== userId) {
    throw new Error("Editors can only nest under their own posts.");
  }
}


export async function createPost(formData: FormData) {
  try {
    return await _createPost(formData);
  } catch (err) {
    // Re-throw Next.js redirect/not-found signals unchanged so they work correctly.
    if (err instanceof Error && (err.message === "NEXT_REDIRECT" || err.message === "NEXT_NOT_FOUND")) throw err;
    // Also re-throw by checking the digest property Next.js sets on these special errors.
    if (err && typeof err === "object" && "digest" in err && typeof (err as { digest: unknown }).digest === "string") {
      const digest = (err as { digest: string }).digest;
      if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND")) throw err;
    }
    console.error("[createPost] Unhandled error:", err);
    throw err;
  }
}

async function _createPost(formData: FormData) {
  const user = await requireAdminOrEditor();
  await loadPlugins();

  const raw = {
    type: (formData.get("type") as string) || "post",
    title: formData.get("title") as string,
    slug: (formData.get("slug") as string) || undefined,
    content: formData.get("content") as string,
    excerpt: (formData.get("excerpt") as string) || undefined,
    publishAt: (formData.get("publishAt") as string) || undefined,
    parentId: parseIntOrNull(formData.get("parentId")),
    aeoMetadata: parseAeoMetadata(formData.get("aeoMetadata") as string | null) ?? undefined,
    seoTitle: (formData.get("seoTitle") as string) || undefined,
    seoMetaDescription: (formData.get("seoMetaDescription") as string) || undefined,
    robotsNoindex: formData.get("robotsNoindex") === "1",
    robotsNofollow: formData.get("robotsNofollow") === "1",
    canonicalUrl: (formData.get("canonicalUrl") as string) || undefined,
    ogImageUrl: (formData.get("ogImageUrl") as string) || undefined,
  };

  const result = postSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Validation failed: ${result.error.issues.map(i => i.message).join(", ")}`);
  }

  if (user.role === "editor") {
    await assertParentIdAuthorized(result.data.parentId ?? null, user.id);
  }

  const slug = result.data.slug || result.data.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const intent = formData.get("intent") as string | null;
  const { published, publishedAt } = resolvePublishState(result.data.publishAt, intent);

  const featuredImage = parseIntOrNull(formData.get("featuredImage"));
  const featured = formData.get("featured") === "1";

  let newPost: (typeof posts.$inferSelect)[];
  try {
    newPost = await db.insert(posts).values({
      type: result.data.type,
      title: result.data.title,
      slug,
      content: result.data.content,
      excerpt: result.data.excerpt,
      published,
      featured,
      publishedAt,
      parentId: result.data.parentId ?? null,
      aeoMetadata: result.data.aeoMetadata ?? null,
      seoTitle: result.data.seoTitle ?? null,
      seoMetaDescription: result.data.seoMetaDescription ?? null,
      robotsNoindex: result.data.robotsNoindex,
      robotsNofollow: result.data.robotsNofollow,
      canonicalUrl: result.data.canonicalUrl ?? null,
      ogImageUrl: result.data.ogImageUrl ?? null,
      featuredImage: featuredImage ?? null,
      authorId: user.id,
    } as typeof posts.$inferInsert).returning();
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new Error(`A post with the slug "${slug}" already exists. Please use a different title or specify a unique slug.`);
    }
    throw err;
  }

  const categoryIds = formData.getAll("categories").map(id => parseInt(id as string, 10)).filter(id => !isNaN(id));
  if (categoryIds.length > 0) {
    await db.insert(postCategories).values(categoryIds.map(categoryId => ({ postId: newPost[0].id, categoryId })));
  }

  const tagIds = formData.getAll("tags").map(id => parseInt(id as string, 10)).filter(id => !isNaN(id));
  if (tagIds.length > 0) {
    await db.insert(postTags).values(tagIds.map(tagId => ({ postId: newPost[0].id, tagId })));
  }

  auditLog({ action: "post.create", userId: user.id, resourceId: newPost[0].id, detail: `slug: ${slug}` });
  await hooks.doAction("post:after-save", { post: newPost[0] as PostPayload });
  if (published) {
    await hooks.doAction("post:after-publish", { post: newPost[0] as PostPayload });
    const siteUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    void pingIndexNow(`${siteUrl}/post/${slug}`, siteUrl);
  }
  revalidatePath("/admin/posts");
  revalidatePath("/");

  if (intent === "draft") {
    redirect(`/admin/posts/${newPost[0].id}/edit`);
  }
  redirect("/admin/posts");
}

export async function updatePost(id: number, formData: FormData) {
  try {
    return await _updatePost(id, formData);
  } catch (err) {
    if (err instanceof Error && (err.message === "NEXT_REDIRECT" || err.message === "NEXT_NOT_FOUND")) throw err;
    if (err && typeof err === "object" && "digest" in err && typeof (err as { digest: unknown }).digest === "string") {
      const digest = (err as { digest: string }).digest;
      if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND")) throw err;
    }
    console.error(`[updatePost id=${id}] Unhandled error:`, err);
    throw err;
  }
}

async function _updatePost(id: number, formData: FormData) {
  const user = await requireAdminOrEditor();
  await loadPlugins();

  if (user.role === "editor") {
    const existing = await db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, id));
    if (!existing[0] || existing[0].authorId !== user.id) {
      throw new Error("Unauthorized: editors can only edit their own posts");
    }
  }

  const raw = {
    type: (formData.get("type") as string) || "post",
    title: formData.get("title") as string,
    slug: (formData.get("slug") as string) || undefined,
    content: formData.get("content") as string,
    excerpt: (formData.get("excerpt") as string) || undefined,
    publishAt: (formData.get("publishAt") as string) || undefined,
    parentId: parseIntOrNull(formData.get("parentId")),
    aeoMetadata: parseAeoMetadata(formData.get("aeoMetadata") as string | null) ?? undefined,
    seoTitle: (formData.get("seoTitle") as string) || undefined,
    seoMetaDescription: (formData.get("seoMetaDescription") as string) || undefined,
    robotsNoindex: formData.get("robotsNoindex") === "1",
    robotsNofollow: formData.get("robotsNofollow") === "1",
    canonicalUrl: (formData.get("canonicalUrl") as string) || undefined,
    ogImageUrl: (formData.get("ogImageUrl") as string) || undefined,
  };

  const result = postSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Validation failed: ${result.error.issues.map(i => i.message).join(", ")}`);
  }

  if (user.role === "editor") {
    await assertParentIdAuthorized(result.data.parentId ?? null, user.id);
  }

  const slug = result.data.slug || result.data.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const intent = formData.get("intent") as string | null;
  const { published, publishedAt } = resolvePublishState(result.data.publishAt, intent);

  const featuredImage = parseIntOrNull(formData.get("featuredImage"));
  const featured = formData.get("featured") === "1";

  let updated: (typeof posts.$inferSelect)[];
  try {
    updated = await db.update(posts)
      .set({
        type: result.data.type,
        title: result.data.title,
        slug,
        content: result.data.content,
        excerpt: result.data.excerpt,
        published,
        featured,
        publishedAt,
        parentId: result.data.parentId ?? null,
        aeoMetadata: result.data.aeoMetadata ?? null,
        seoTitle: result.data.seoTitle ?? null,
        seoMetaDescription: result.data.seoMetaDescription ?? null,
        robotsNoindex: result.data.robotsNoindex,
        robotsNofollow: result.data.robotsNofollow,
        canonicalUrl: result.data.canonicalUrl ?? null,
        ogImageUrl: result.data.ogImageUrl ?? null,
        featuredImage: featuredImage ?? null,
        updatedAt: new Date(),
      } as Partial<typeof posts.$inferInsert>)
      .where(eq(posts.id, id))
      .returning();
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new Error(`A post with the slug "${slug}" already exists. Please choose a unique slug.`);
    }
    throw err;
  }

  await db.delete(postCategories).where(eq(postCategories.postId, id));
  const categoryIds = formData.getAll("categories").map(cid => parseInt(cid as string)).filter(cid => !isNaN(cid));
  if (categoryIds.length > 0) {
    await db.insert(postCategories).values(categoryIds.map(categoryId => ({ postId: id, categoryId })));
  }

  await db.delete(postTags).where(eq(postTags.postId, id));
  const tagIds = formData.getAll("tags").map(tid => parseInt(tid as string)).filter(tid => !isNaN(tid));
  if (tagIds.length > 0) {
    await db.insert(postTags).values(tagIds.map(tagId => ({ postId: id, tagId })));
  }

  auditLog({ action: "post.update", userId: user.id, resourceId: id });
  await hooks.doAction("post:after-save", { post: updated[0] as PostPayload });
  if (published) {
    await hooks.doAction("post:after-publish", { post: updated[0] as PostPayload });
    const siteUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    void pingIndexNow(`${siteUrl}/post/${slug}`, siteUrl);
  }
  revalidatePath("/admin/posts");
  revalidatePath("/");

  if (intent === "draft") {
    redirect(`/admin/posts/${id}/edit`);
  }
  redirect("/admin/posts");
}

export async function autosavePost(
  id: number,
  data: {
    title: string;
    slug: string;
    content: string;
    excerpt?: string;
    seoTitle?: string;
    seoMetaDescription?: string;
    aeoMetadata?: unknown;
    canonicalUrl?: string;
    ogImageUrl?: string;
  }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireAdminOrEditor();
    await loadPlugins();

    if (user.role === "editor") {
      const existing = await db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, id));
      if (!existing[0] || existing[0].authorId !== user.id) {
        return { ok: false, error: "Unauthorized" };
      }
    }

    if (!data.title?.trim() || !data.content?.trim()) {
      return { ok: false, error: "Title and content are required" };
    }

    await db.update(posts)
      .set({
        title: data.title,
        slug: data.slug || data.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
        content: data.content,
        excerpt: data.excerpt ?? null,
        seoTitle: data.seoTitle ?? null,
        seoMetaDescription: data.seoMetaDescription ?? null,
        aeoMetadata: (data.aeoMetadata as Record<string, unknown>) ?? null,
        canonicalUrl: data.canonicalUrl ?? null,
        ogImageUrl: data.ogImageUrl ?? null,
        updatedAt: new Date(),
      } as Partial<typeof posts.$inferInsert>)
      .where(eq(posts.id, id));

    // No revalidatePath here — autosave is a silent background write.
    // Revalidating the edit route would trigger a router refresh mid-keystroke,
    // causing the AI input (and other fields) to lose focus.
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Autosave failed" };
  }
}

/**
 * Lightweight AEO-only save used by Bulk AEO.
 * Writes only the aeoMetadata column — does not touch revisions, revalidate
 * paths, or run plugin hooks. Returns ok/error for client-side progress tracking.
 */
export async function bulkSaveAeo(
  postId: number,
  aeoMetadata: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireAdminOrEditor();

    // Editors may only touch their own posts — same rule as update/delete.
    if (user.role === "editor") {
      const existing = await db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, postId));
      if (!existing[0] || existing[0].authorId !== user.id) {
        return { ok: false, error: "Unauthorized: editors can only edit their own posts" };
      }
    }

    await db
      .update(posts)
      .set({ aeoMetadata, updatedAt: new Date() } as Partial<typeof posts.$inferInsert>)
      .where(eq(posts.id, postId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Save failed" };
  }
}

export async function deletePost(id: number) {
  const user = await requireAdminOrEditor();
  await loadPlugins();

  if (user.role === "editor") {
    const existing = await db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, id));
    if (!existing[0] || existing[0].authorId !== user.id) {
      throw new Error("Unauthorized: editors can only delete their own posts");
    }
  }

  await hooks.doAction("post:before-delete", { postId: id });
  await db.delete(posts).where(eq(posts.id, id));
  auditLog({ action: "post.delete", userId: user.id, resourceId: id });
  revalidatePath("/admin/posts");
  revalidatePath("/");

}

