/**
 * PUGMILL ADMIN NOTIFICATION SYSTEM
 * ============================================================
 * Core-owned API for surfacing plugin events to admin users.
 * Plugins call createNotification() from inside hook listeners.
 *
 * PLUGIN AUTHOR QUICK START
 *
 *   import { createNotification } from "../../src/lib/notifications";
 *
 *   // In your plugin's initialize():
 *   hooks.addAction("post:after-save", async ({ post }) => {
 *     await createNotification({
 *       pluginId: "my-plugin",
 *       message: `Post "${post.title}" was saved.`,
 *       href: "/admin/posts",
 *       replaceKey: `post-saved-${post.id}`, // omit to create a new row each time
 *     });
 *   });
 *
 * USE replaceKey TO PREVENT NOTIFICATION BLOAT
 *   A notification with the same (pluginId, replaceKey) will upsert —
 *   updating the message and resetting read to false — rather than
 *   inserting a new row. Use this for aggregate notifications like
 *   "X comments awaiting moderation" where the count changes but you
 *   don't want a separate notification per event.
 *
 * TEARDOWN
 *   Call deletePluginNotifications(pluginId) from your plugin's teardown()
 *   to remove all notification rows on uninstall.
 * ============================================================
 */

import { db } from "./db";
import { adminNotifications } from "./db/schema";
import { eq, and, desc, count, sum, sql } from "drizzle-orm";

// ─── Core schema bootstrap ────────────────────────────────────────────────────

/**
 * Idempotently create the admin_notifications table and its partial unique index.
 * Called from loadPlugins() on every cold start — safe to run repeatedly.
 * Mirrors the plugin schema.migrate() pattern so core tables are also self-healing.
 */
export async function ensureCoreNotificationsSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id          SERIAL PRIMARY KEY,
      plugin_id   TEXT NOT NULL,
      type        VARCHAR(20) NOT NULL DEFAULT 'info',
      message     TEXT NOT NULL,
      href        TEXT,
      replace_key TEXT,
      read        BOOLEAN NOT NULL DEFAULT FALSE,
      item_count  INTEGER NOT NULL DEFAULT 1,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS admin_notifications_plugin_replace_key_idx
      ON admin_notifications (plugin_id, replace_key)
      WHERE replace_key IS NOT NULL
  `);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType = "info" | "warning" | "error";

export interface NotificationRow {
  id: number;
  pluginId: string;
  type: string;
  message: string;
  href: string | null;
  replaceKey: string | null;
  read: boolean;
  itemCount: number;
  createdAt: Date;
}

export interface CreateNotificationPayload {
  /** ID of the plugin creating the notification. Use "core" for core-generated alerts. */
  pluginId: string;
  type?: NotificationType;
  message: string;
  /** Where the admin should navigate to act on this notification. */
  href?: string;
  /**
   * Stable key for upsert deduplication.
   * If provided, a notification with the same (pluginId, replaceKey) will be updated
   * rather than a new row inserted. The existing notification is marked unread again.
   * Omit to always create a new notification row.
   */
  replaceKey?: string;
  /**
   * The number of items this notification represents.
   * Use this for grouped notifications (e.g. "3 comments pending" → itemCount: 3).
   * Defaults to 1. The sidebar badge sums itemCount across unread notifications.
   */
  itemCount?: number;
}

// ─── Write API ────────────────────────────────────────────────────────────────

/**
 * Create or upsert an admin notification.
 * If replaceKey is provided and a matching notification exists,
 * it is updated in place and marked unread again.
 */
export async function createNotification(payload: CreateNotificationPayload): Promise<void> {
  const row = {
    pluginId: payload.pluginId,
    type: payload.type ?? "info",
    message: payload.message,
    href: payload.href ?? null,
    replaceKey: payload.replaceKey ?? null,
    read: false,
    itemCount: payload.itemCount ?? 1,
  } as typeof adminNotifications.$inferInsert;

  if (payload.replaceKey) {
    await db
      .insert(adminNotifications)
      .values(row)
      .onConflictDoUpdate({
        target: [adminNotifications.pluginId, adminNotifications.replaceKey],
        targetWhere: sql`replace_key IS NOT NULL`,
        set: {
          message: sql`EXCLUDED.message`,
          href: sql`EXCLUDED.href`,
          type: sql`EXCLUDED.type`,
          read: sql`false`,
          itemCount: sql`EXCLUDED.item_count`,
          createdAt: sql`NOW()`,
        } as Record<string, unknown>,
      });
  } else {
    await db.insert(adminNotifications).values(row);
  }
}

/**
 * Mark all unread notifications for a plugin as read.
 * Call this when an admin visits the plugin's admin page so the badge clears.
 */
export async function markPluginNotificationsRead(pluginId: string): Promise<void> {
  await db
    .update(adminNotifications)
    .set({ read: true } as Partial<typeof adminNotifications.$inferInsert>)
    .where(and(eq(adminNotifications.pluginId, pluginId), eq(adminNotifications.read, false)));
}

/**
 * Mark a single notification as read by ID.
 * Used when an admin clicks a notification in the feed.
 */
export async function markNotificationRead(id: number): Promise<void> {
  await db
    .update(adminNotifications)
    .set({ read: true } as Partial<typeof adminNotifications.$inferInsert>)
    .where(eq(adminNotifications.id, id));
}

/**
 * Mark every unread notification as read.
 * Used by the "Mark all read" action on the notifications feed page.
 */
export async function markAllNotificationsRead(): Promise<void> {
  await db
    .update(adminNotifications)
    .set({ read: true } as Partial<typeof adminNotifications.$inferInsert>)
    .where(eq(adminNotifications.read, false));
}

/**
 * Delete a single notification by its replaceKey.
 * Use this to remove a transient aggregate notification (e.g. "X items pending")
 * once the condition it represents has been resolved.
 */
export async function deleteNotificationByReplaceKey(pluginId: string, replaceKey: string): Promise<void> {
  await db
    .delete(adminNotifications)
    .where(and(eq(adminNotifications.pluginId, pluginId), eq(adminNotifications.replaceKey, replaceKey)));
}

/**
 * Delete all notification rows for a plugin.
 * Call this from your plugin's teardown() to clean up on uninstall.
 */
export async function deletePluginNotifications(pluginId: string): Promise<void> {
  await db.delete(adminNotifications).where(eq(adminNotifications.pluginId, pluginId));
}

// ─── Read API ─────────────────────────────────────────────────────────────────

/**
 * Returns unread notification counts grouped by plugin ID.
 * Single query regardless of how many plugins are installed.
 * Used by the admin layout to populate sidebar badges.
 */
export async function getUnreadCountsByPlugin(): Promise<Record<string, number>> {
  const rows = await db
    .select({ pluginId: adminNotifications.pluginId, total: sum(adminNotifications.itemCount) })
    .from(adminNotifications)
    .where(eq(adminNotifications.read, false))
    .groupBy(adminNotifications.pluginId);
  return Object.fromEntries(rows.map(r => [r.pluginId, Number(r.total ?? 0)]));
}

/**
 * List notifications for the admin feed page.
 * Defaults to 100 most recent, all plugins, all read states.
 */
export async function listNotifications(options: {
  pluginId?: string;
  unreadOnly?: boolean;
  limit?: number;
} = {}): Promise<NotificationRow[]> {
  const conditions = [];
  if (options.pluginId) conditions.push(eq(adminNotifications.pluginId, options.pluginId));
  if (options.unreadOnly) conditions.push(eq(adminNotifications.read, false));

  return db
    .select()
    .from(adminNotifications)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adminNotifications.createdAt))
    .limit(options.limit ?? 100);
}
