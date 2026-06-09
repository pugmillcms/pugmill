"use server";
import { revalidatePath } from "next/cache";
import { db } from "../../src/lib/db";
import { pluginNewsletterSubscribers, pluginNewsletterSends } from "./schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "../../src/lib/get-current-user";
import { loadPlugins } from "../../src/lib/plugin-loader";
import { getSubscriberByToken, getActiveSubscribers } from "./db";
import { posts } from "../../src/lib/db/schema";
import { z } from "zod";
import crypto from "crypto";
import { auditLog } from "../../src/lib/audit-log";
import { headers } from "next/headers";
import { getClientIp } from "../../src/lib/get-client-ip";
import { submissionLimiter, SUBMISSION_RATE_LIMIT } from "../../src/lib/rate-limit";

// ─── Auth helper ───────────────────────────────────────────────────────────────

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Forbidden");
  return user;
}

// ─── Public: subscribe ────────────────────────────────────────────────────────

const subscribeSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  name:  z.string().max(100).optional(),
});

export async function subscribeNewsletter(
  formData: FormData
): Promise<{ ok: boolean; error?: string; alreadySubscribed?: boolean }> {
  await loadPlugins();

  // Honeypot — a hidden field real users never fill. Report success so a bot
  // that auto-fills every input learns nothing.
  if (((formData.get("_hp") as string) ?? "").length > 0) {
    return { ok: true };
  }

  // Rate limit by IP — max 5 submissions per 10 minutes (shared limiter).
  const ip = getClientIp(await headers());
  if (!submissionLimiter.check(`newsletter:${ip}`, SUBMISSION_RATE_LIMIT).success) {
    return { ok: false, error: "Too many requests. Please try again in a little while." };
  }

  const parsed = subscribeSchema.safeParse({
    email: formData.get("email"),
    name:  (formData.get("name") as string) || undefined,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };

  const { email, name } = parsed.data;
  const token = crypto.randomBytes(32).toString("hex");

  try {
    await db.insert(pluginNewsletterSubscribers).values({
      email:  email.toLowerCase().trim(),
      name:   name?.trim() || null,
      token,
    } as typeof pluginNewsletterSubscribers.$inferInsert).onConflictDoNothing();
  } catch {
    return { ok: false, error: "Could not subscribe. Please try again." };
  }

  // Check if they were already subscribed (onConflictDoNothing silently skips)
  const existingRows = await db
    .select()
    .from(pluginNewsletterSubscribers)
    .where(eq(pluginNewsletterSubscribers.email, email.toLowerCase().trim()))
    .limit(1);
  const existing = existingRows[0] ?? null;
  if (existing?.unsubscribedAt) {
    // Re-subscribe: clear the unsubscribed_at
    await db
      .update(pluginNewsletterSubscribers)
      .set({ unsubscribedAt: null } as Partial<typeof pluginNewsletterSubscribers.$inferInsert>)
      .where(eq(pluginNewsletterSubscribers.email, email.toLowerCase().trim()));
  }

  revalidatePath("/admin/plugins/newsletter");
  return { ok: true };
}

// ─── Public: unsubscribe by token ─────────────────────────────────────────────

export async function unsubscribeByToken(
  token: string
): Promise<{ ok: boolean; error?: string }> {
  await loadPlugins();

  if (!token) return { ok: false, error: "Invalid unsubscribe link." };

  const subscriber = await getSubscriberByToken(token);
  if (!subscriber) return { ok: false, error: "Unsubscribe link not found." };
  if (subscriber.unsubscribedAt) return { ok: true }; // already unsubscribed

  await db
    .update(pluginNewsletterSubscribers)
    .set({ unsubscribedAt: new Date() } as Partial<typeof pluginNewsletterSubscribers.$inferInsert>)
    .where(eq(pluginNewsletterSubscribers.token, token));

  revalidatePath("/admin/plugins/newsletter");
  return { ok: true };
}

// ─── Admin: delete subscriber ─────────────────────────────────────────────────

export async function deleteSubscriber(id: number): Promise<void> {
  await requireAdmin();
  await loadPlugins();
  await db.delete(pluginNewsletterSubscribers).where(eq(pluginNewsletterSubscribers.id, id));
  revalidatePath("/admin/plugins/newsletter");
}

// ─── Admin: manual send ───────────────────────────────────────────────────────

export async function sendNewsletterManually(
  formData: FormData
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const user = await requireAdmin();
  await loadPlugins();

  const postId = Number(formData.get("postId"));
  const subject = ((formData.get("subject") as string) ?? "").trim();
  const replyToOverride = ((formData.get("replyTo") as string) ?? "").trim() || undefined;

  if (!postId || isNaN(postId)) return { ok: false, error: "Please select a post." };
  if (!subject) return { ok: false, error: "Subject line is required." };

  try {
    const { sendEmail } = await import("../../src/lib/email");
    const { getConfig }  = await import("../../src/lib/config");

    const config  = await getConfig();
    const siteUrl = (config.site.url ?? "").replace(/\/$/, "");
    const replyTo = replyToOverride || config.email?.toAddress || undefined;

    // Fetch the post being sent
    const postRows = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    const post = postRows[0];
    if (!post) return { ok: false, error: "Post not found." };

    const postUrl = post.type === "page"
      ? `${siteUrl}/${post.slug}`
      : `${siteUrl}/post/${post.slug}`;

    const subscribers = await getActiveSubscribers();
    if (subscribers.length === 0) {
      return { ok: false, error: "No active subscribers to send to." };
    }

    let successCount = 0;
    let failCount    = 0;

    await Promise.allSettled(
      subscribers.map(async (subscriber) => {
        const unsubscribeUrl = `${siteUrl}/newsletter/unsubscribe?token=${subscriber.token}`;
        const result = await sendEmail({
          to:      subscriber.email,
          subject,
          replyTo,
          text: [
            post.title,
            "",
            `Read: ${postUrl}`,
            "",
            "---",
            `Unsubscribe: ${unsubscribeUrl}`,
          ].join("\n"),
          html: [
            `<h2>${post.title}</h2>`,
            `<p><a href="${postUrl}">Read the full post →</a></p>`,
            `<hr>`,
            `<p style="font-size:12px;color:#666;">`,
            `  <a href="${unsubscribeUrl}">Unsubscribe</a> from this list.`,
            `</p>`,
          ].join("\n"),
        });
        if (result.ok) { successCount++; } else { failCount++; }
      })
    );

    await db.insert(pluginNewsletterSends).values({
      postId,
      subject,
      recipientCount: subscribers.length,
      successCount,
      failCount,
    } as typeof pluginNewsletterSends.$inferInsert);

    auditLog({
      action: "newsletter.manual_send",
      userId: user.id,
      detail: `postId=${postId}, subject="${subject}", recipients=${subscribers.length}, delivered=${successCount}, failed=${failCount}`,
    });

    revalidatePath("/admin/plugins/newsletter");
    return { ok: true, count: successCount };
  } catch (err) {
    console.error("[newsletter] Manual send failed:", err);
    return { ok: false, error: "Send failed. Check email configuration in Settings → Email." };
  }
}
