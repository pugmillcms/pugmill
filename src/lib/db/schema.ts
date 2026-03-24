import { pgTable, serial, text, timestamp, boolean, integer, varchar, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// --- Posts Table ---
export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  // Content type: 'post' for blog entries, 'page' for static site pages
  type: varchar("type", { length: 20 }).default("post").notNull(),
  title: text("title").notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  content: text("content").notNull(),
  excerpt: text("excerpt"),
  featuredImage: integer("featured_image").references(() => media.id),
  published: boolean("published").default(false).notNull(),
  featured: boolean("featured").default(false).notNull(),
  publishedAt: timestamp("published_at"),
  authorId: text("author_id").references(() => adminUsers.id),
  // Self-referencing FK for hierarchical pages (null = top-level)
  parentId: integer("parent_id"),
  // AEO: structured Q&A pairs and entity data for AI crawlers.
  // Shape: { summary?: string, questions?: { q: string, a: string }[], entities?: { type: string, name: string, description?: string }[] }
  aeoMetadata: jsonb("aeo_metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // Feed queries always filter by published+type — composite index covers both.
  index("posts_published_type_idx").on(t.published, t.type),
  // Author-scoped queries (editor dashboard, audit, ownership checks).
  index("posts_author_id_idx").on(t.authorId),
]);

// --- Media Table ---
export const media = pgTable("media", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  fileType: varchar("file_type", { length: 50 }),
  fileSize: integer("file_size"),
  url: text("url").notNull(),
  // Storage key used by the active StorageProvider to delete the object.
  // For local: "uploads/filename.jpg". For S3: the S3 object key.
  // Nullable for backwards compatibility with records created before this column existed.
  storageKey: text("storage_key"),
  altText: text("alt_text"),
  uploaderId: text("uploader_id").references(() => adminUsers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- Settings Table ---
export const settings = pgTable("settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// --- NextAuth Tables ---
export const accounts = pgTable("accounts", {
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

// NextAuth-compatible admin users table
export const adminUsers = pgTable("admin_users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),
  role: varchar("role", { length: 20 }).default("editor").notNull(),
  authorVoice: text("author_voice"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- Categories Table ---
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- Tags Table ---
export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- Post Categories (join table) ---
export const postCategories = pgTable("post_categories", {
  postId: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  categoryId: integer("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
});

// --- Post Tags (join table) ---
export const postTags = pgTable("post_tags", {
  postId: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
});

// --- Site Configuration Table ---
// Stores the CMS configuration in a single JSONB row.
// Use id=1 always. Config is seeded on first boot from defaults.
export const siteConfig = pgTable("site_config", {
  id: integer("id").primaryKey().default(1),
  config: jsonb("config").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// --- Theme Design Configs Table ---
// Stores per-theme design token overrides.
// Rows have a status: 'draft' (staged), 'published' (live), or 'archived' (previous publish).
// Only one 'draft' and one 'published' row per themeId should exist at a time.
export const themeDesignConfigs = pgTable("theme_design_configs", {
  id: serial("id").primaryKey(),
  themeId: varchar("theme_id", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(), // 'published' | 'draft' | 'archived'
  config: jsonb("config").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // Only one draft and one published row per theme at a time.
  // Archived rows are kept for history and are not covered by this index.
  uniqueIndex("theme_design_configs_theme_active_status_idx")
    .on(t.themeId, t.status)
    .where(sql`status IN ('draft', 'published')`),
]);

// --- Admin Notifications Table ---
// Core-owned. Plugins write rows via createNotification() in src/lib/notifications.ts.
// pluginId is a plain string (no FK) — orphaned rows from uninstalled plugins are harmless.
// replaceKey enables upsert deduplication: notifications with the same (pluginId, replaceKey)
// update in place rather than accumulating, keeping the feed clean for high-frequency events.
export const adminNotifications = pgTable("admin_notifications", {
  id: serial("id").primaryKey(),
  /** "comments", "core", etc. Plain string — no FK to plugin registry. */
  pluginId: text("plugin_id").notNull(),
  type: varchar("type", { length: 20 }).notNull().default("info"), // "info" | "warning" | "error"
  message: text("message").notNull(),
  /** Optional deep link — where the admin should go to act on this notification. */
  href: text("href"),
  /** Stable key for upsert deduplication. Notifications with matching (pluginId, replaceKey) upsert. */
  replaceKey: text("replace_key"),
  read: boolean("read").notNull().default(false),
  /** For grouped notifications (e.g. "3 comments pending"), the actual item count. Defaults to 1. */
  itemCount: integer("item_count").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("admin_notifications_plugin_replace_key_idx")
    .on(t.pluginId, t.replaceKey)
    .where(sql`replace_key IS NOT NULL`),
]);

// --- Audit Log Table ---
// Immutable record of admin actions. Written fire-and-forget via auditLog() in src/lib/audit-log.ts.
// userId and resourceId are stored as text to accommodate both UUID (admin_users) and integer IDs.
// No FK constraints — audit rows must outlive the records they reference.
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  action: varchar("action", { length: 100 }).notNull(),
  userId: text("user_id"),
  resourceId: text("resource_id"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Widget Settings Table ---
// Stores per-widget configuration (e.g. count, API keys set by admin).
// One row per (widgetId, key) pair. Unique index prevents duplicates.
export const widgetSettings = pgTable("widget_settings", {
  id: serial("id").primaryKey(),
  widgetId: text("widget_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("widget_settings_widget_key_idx").on(t.widgetId, t.key),
]);

// --- AI Usage Table ---
// Per-user hourly AI call counter. One row per user; window resets after 1 hour.
// userId is the PK — no FK so orphaned rows from deleted users are harmless.
export const aiUsage = pgTable("ai_usage", {
  userId:      text("user_id").primaryKey(),
  windowStart: timestamp("window_start").notNull().defaultNow(),
  count:       integer("count").notNull().default(0),
});

// --- Relations ---
export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(adminUsers, { fields: [posts.authorId], references: [adminUsers.id] }),
  image: one(media, { fields: [posts.featuredImage], references: [media.id] }),
  parent: one(posts, { fields: [posts.parentId], references: [posts.id], relationName: "childPages" }),
  children: many(posts, { relationName: "childPages" }),
  postCategories: many(postCategories),
  postTags: many(postTags),
}));

export const mediaRelations = relations(media, ({ one }) => ({
  uploader: one(adminUsers, { fields: [media.uploaderId], references: [adminUsers.id] }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  postCategories: many(postCategories),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  postTags: many(postTags),
}));

export const postCategoriesRelations = relations(postCategories, ({ one }) => ({
  post: one(posts, { fields: [postCategories.postId], references: [posts.id] }),
  category: one(categories, { fields: [postCategories.categoryId], references: [categories.id] }),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(posts, { fields: [postTags.postId], references: [posts.id] }),
  tag: one(tags, { fields: [postTags.tagId], references: [tags.id] }),
}));
