"use server";
import { revalidatePath } from "next/cache";
import { db } from "../../src/lib/db";
import { pluginWebhooksEndpoints } from "./schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "../../src/lib/get-current-user";
import { loadPlugins } from "../../src/lib/plugin-loader";
import { encryptString } from "../../src/lib/encrypt";
import { assertPublicHttpUrl } from "../../src/lib/ssrf";
import { z } from "zod";

// Auth check only — no loadPlugins() here per §12 of PLUGIN_AUTHORING.md.
// Each exported action calls loadPlugins() itself so listeners are active.
async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Forbidden");
  return user;
}

const endpointSchema = z.object({
  name:   z.string().min(1).max(100),
  url:    z.string().url("Must be a valid URL"),
  secret: z.string().max(256).optional(),
  events: z.array(z.string()).min(1, "Select at least one event"),
});

export async function createEndpoint(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  await loadPlugins();

  const events = formData.getAll("events") as string[];
  const parsed = endpointSchema.safeParse({
    name:   formData.get("name"),
    url:    formData.get("url"),
    secret: formData.get("secret") || undefined,
    events,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0].message };
  }

  // SSRF guard: reject endpoints that resolve to internal/reserved addresses.
  try {
    await assertPublicHttpUrl(parsed.data.url.trim());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "URL is not allowed" };
  }

  const secret = parsed.data.secret ? encryptString(parsed.data.secret) : "";

  await db.insert(pluginWebhooksEndpoints).values({
    name:   parsed.data.name.trim(),
    url:    parsed.data.url.trim(),
    secret,
    events: JSON.stringify(parsed.data.events),
    active: true,
  } as typeof pluginWebhooksEndpoints.$inferInsert);

  revalidatePath("/admin/plugins/outbound-webhooks");
  return { ok: true };
}

export async function toggleEndpoint(id: number, active: boolean): Promise<void> {
  await requireAdmin();
  await loadPlugins();

  await db
    .update(pluginWebhooksEndpoints)
    .set({ active, updatedAt: new Date() } as Partial<typeof pluginWebhooksEndpoints.$inferInsert>)
    .where(eq(pluginWebhooksEndpoints.id, id));

  revalidatePath("/admin/plugins/outbound-webhooks");
}

export async function deleteEndpoint(id: number): Promise<void> {
  await requireAdmin();
  await loadPlugins();

  await db.delete(pluginWebhooksEndpoints).where(eq(pluginWebhooksEndpoints.id, id));
  revalidatePath("/admin/plugins/outbound-webhooks");
}
