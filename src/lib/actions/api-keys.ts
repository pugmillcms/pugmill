"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { eq, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/get-current-user";
import { auditLog } from "@/lib/audit-log";
import { generateApiToken } from "@/lib/api-auth";
import { z } from "zod";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Forbidden");
  return user;
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  scope: z.enum(["read", "readwrite"]).default("read"),
});

/**
 * createApiKey
 *
 * Generates a new API token. Returns the full token ONCE — it is never stored.
 * Scope defaults to "read"; "readwrite" additionally unlocks content-mutating
 * MCP tools. On success: { token, prefix, id }. On error: { error }.
 */
export async function createApiKey(formData: FormData): Promise<
  { token: string; prefix: string; id: number } | { error: string }
> {
  const user = await requireAdmin();

  const rawScope = (formData.get("scope") as string) || "read";
  const parsed = createSchema.safeParse({ name: formData.get("name"), scope: rawScope });
  if (!parsed.success) return { error: "Name is required (max 100 chars)." };

  const { token, hash, prefix } = generateApiToken();

  const [row] = await db
    .insert(apiKeys)
    .values({
      name: parsed.data.name.trim(),
      keyPrefix: prefix,
      keyHash: hash,
      scope: parsed.data.scope,
      createdBy: user.id,
    } as typeof apiKeys.$inferInsert)
    .returning({ id: apiKeys.id });

  auditLog({
    action: "api_key.create",
    userId: user.id,
    resourceId: row.id,
    detail: `${parsed.data.name} (${parsed.data.scope})`,
  });
  revalidatePath("/admin/settings/api-keys");
  return { token, prefix, id: row.id };
}

/**
 * listApiKeys
 *
 * Returns all non-revoked keys (prefix, name, lastUsedAt, createdAt).
 * The hash is never returned.
 */
export async function listApiKeys() {
  await requireAdmin();
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      scope: apiKeys.scope,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(apiKeys.createdAt);
}

/**
 * revokeApiKey
 *
 * Stamps revokedAt. The row is kept for the audit trail.
 */
export async function revokeApiKey(id: number): Promise<{ ok: boolean; error?: string }> {
  const user = await requireAdmin();

  const rows = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, id));
  if (!rows.length) return { ok: false, error: "Key not found." };

  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() } as Partial<typeof apiKeys.$inferInsert>)
    .where(eq(apiKeys.id, id));

  auditLog({ action: "api_key.revoke", userId: user.id, resourceId: id });
  revalidatePath("/admin/settings/api-keys");
  return { ok: true };
}
