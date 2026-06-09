/**
 * create-schema.ts
 *
 * Creates all Pugmill database tables using IF NOT EXISTS guards.
 * Safe to run on a blank database or an existing one — never drops or alters.
 * Does NOT require drizzle-kit or a TTY. Works in Replit, CI, Docker, etc.
 *
 * Called by: npm run db:init
 * Also imported by: scripts/replit-init.ts
 */
import { existsSync } from "fs";
import { config } from "dotenv";
if (existsSync(".env.local")) config({ path: ".env.local" });

import { db } from "../src/lib/db";
import { sql } from "drizzle-orm";

export async function createSchema() {
  console.log("  Creating database tables...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "admin_users" (
      "id"             TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "name"           TEXT,
      "email"          TEXT         NOT NULL UNIQUE,
      "email_verified" TIMESTAMP,
      "image"          TEXT,
      "password_hash"  TEXT,
      "role"           VARCHAR(20)  NOT NULL DEFAULT 'editor',
      "author_voice"   TEXT,
      "created_at"     TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "accounts" (
      "user_id"            TEXT    NOT NULL,
      "type"               TEXT    NOT NULL,
      "provider"           TEXT    NOT NULL,
      "provider_account_id" TEXT   NOT NULL,
      "refresh_token"      TEXT,
      "access_token"       TEXT,
      "expires_at"         INTEGER,
      "token_type"         TEXT,
      "scope"              TEXT,
      "id_token"           TEXT,
      "session_state"      TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "sessions" (
      "session_token" TEXT      PRIMARY KEY,
      "user_id"       TEXT      NOT NULL,
      "expires"       TIMESTAMP NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "verification_tokens" (
      "identifier" TEXT      NOT NULL,
      "token"      TEXT      NOT NULL,
      "expires"    TIMESTAMP NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "media" (
      "id"          SERIAL   PRIMARY KEY,
      "file_name"   TEXT     NOT NULL,
      "file_type"   VARCHAR(50),
      "file_size"   INTEGER,
      "url"         TEXT     NOT NULL,
      "storage_key" TEXT,
      "alt_text"    TEXT,
      "uploader_id" TEXT     REFERENCES "admin_users"("id"),
      "created_at"  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "posts" (
      "id"                   SERIAL        PRIMARY KEY,
      "type"                 VARCHAR(20)   NOT NULL DEFAULT 'post',
      "title"                TEXT          NOT NULL,
      "slug"                 VARCHAR(255)  NOT NULL UNIQUE,
      "content"              TEXT          NOT NULL,
      "excerpt"              TEXT,
      "featured_image"       INTEGER       REFERENCES "media"("id"),
      "published"            BOOLEAN       NOT NULL DEFAULT FALSE,
      "featured"             BOOLEAN       NOT NULL DEFAULT FALSE,
      "published_at"         TIMESTAMP,
      "author_id"            TEXT          REFERENCES "admin_users"("id"),
      "parent_id"            INTEGER,
      "aeo_metadata"         JSONB,
      "seo_title"            TEXT,
      "seo_meta_description" TEXT,
      "robots_noindex"       BOOLEAN       NOT NULL DEFAULT FALSE,
      "robots_nofollow"      BOOLEAN       NOT NULL DEFAULT FALSE,
      "canonical_url"        TEXT,
      "og_image_url"         TEXT,
      "created_at"           TIMESTAMP     NOT NULL DEFAULT NOW(),
      "updated_at"           TIMESTAMP     NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "posts_published_type_idx" ON "posts"("published", "type")
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "posts_author_id_idx" ON "posts"("author_id")
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "settings" (
      "key"        VARCHAR(100) PRIMARY KEY,
      "value"      TEXT         NOT NULL,
      "updated_at" TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "categories" (
      "id"          SERIAL        PRIMARY KEY,
      "name"        VARCHAR(100)  NOT NULL UNIQUE,
      "slug"        VARCHAR(100)  NOT NULL UNIQUE,
      "description" TEXT,
      "created_at"  TIMESTAMP     NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "tags" (
      "id"         SERIAL        PRIMARY KEY,
      "name"       VARCHAR(100)  NOT NULL UNIQUE,
      "slug"       VARCHAR(100)  NOT NULL UNIQUE,
      "created_at" TIMESTAMP     NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "post_categories" (
      "post_id"     INTEGER NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
      "category_id" INTEGER NOT NULL REFERENCES "categories"("id") ON DELETE CASCADE
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "post_tags" (
      "post_id" INTEGER NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
      "tag_id"  INTEGER NOT NULL REFERENCES "tags"("id") ON DELETE CASCADE
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "site_config" (
      "id"         INTEGER   PRIMARY KEY DEFAULT 1,
      "config"     JSONB     NOT NULL,
      "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "theme_design_configs" (
      "id"         SERIAL        PRIMARY KEY,
      "theme_id"   VARCHAR(100)  NOT NULL,
      "status"     VARCHAR(20)   NOT NULL,
      "config"     JSONB         NOT NULL,
      "created_at" TIMESTAMP     NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMP     NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "theme_design_configs_theme_active_status_idx"
    ON "theme_design_configs"("theme_id", "status")
    WHERE status IN ('draft', 'published')
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "admin_notifications" (
      "id"          SERIAL        PRIMARY KEY,
      "plugin_id"   TEXT          NOT NULL,
      "type"        VARCHAR(20)   NOT NULL DEFAULT 'info',
      "message"     TEXT          NOT NULL,
      "href"        TEXT,
      "replace_key" TEXT,
      "read"        BOOLEAN       NOT NULL DEFAULT FALSE,
      "item_count"  INTEGER       NOT NULL DEFAULT 1,
      "created_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "admin_notifications_plugin_replace_key_idx"
    ON "admin_notifications"("plugin_id", "replace_key")
    WHERE replace_key IS NOT NULL
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "audit_logs" (
      "id"          SERIAL        PRIMARY KEY,
      "action"      VARCHAR(100)  NOT NULL,
      "user_id"     TEXT,
      "resource_id" TEXT,
      "detail"      TEXT,
      "created_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "widget_settings" (
      "id"         SERIAL PRIMARY KEY,
      "widget_id"  TEXT   NOT NULL,
      "key"        TEXT   NOT NULL,
      "value"      TEXT   NOT NULL,
      "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "widget_settings_widget_key_idx"
    ON "widget_settings"("widget_id", "key")
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "api_keys" (
      "id"           SERIAL       PRIMARY KEY,
      "name"         TEXT         NOT NULL,
      "key_prefix"   VARCHAR(16)  NOT NULL,
      "key_hash"     TEXT         NOT NULL UNIQUE,
      "scope"        TEXT         NOT NULL DEFAULT 'read',
      "created_by"   TEXT         REFERENCES "admin_users"("id") ON DELETE SET NULL,
      "last_used_at" TIMESTAMP,
      "revoked_at"   TIMESTAMP,
      "created_at"   TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "ai_usage" (
      "user_id"      TEXT      PRIMARY KEY,
      "window_start" TIMESTAMP NOT NULL DEFAULT NOW(),
      "count"        INTEGER   NOT NULL DEFAULT 0
    )
  `);

  // Plugin tables are created by each plugin's schema.migrate() method,
  // called automatically via loadPlugins() on first server startup.
  // They are intentionally omitted here to keep create-schema.ts focused
  // on core tables only and avoid schema drift between the two sources.

  // ── Migration tracking table ──────────────────────────────────────────────
  // Also owned by run-migrations.ts (CREATE IF NOT EXISTS there too).
  // Creating it here ensures it exists before the pre-mark step below.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Fresh-install optimisation: pre-mark all migrations as applied ─────────
  // create-schema creates the full current schema in one shot, so all column-add
  // migrations are redundant on a blank database.  By pre-marking them here,
  // the subsequent run-migrations call becomes a no-op (instant [skip] per file)
  // instead of spawning 8+ child processes, which was causing Replit's predev
  // timeout on first boot.
  //
  // Safety: we only do this when schema_migrations is empty (i.e. run-migrations
  // has never run before).  On existing installs schema_migrations already has
  // entries, so this block is skipped and run-migrations handles the delta normally.
  const { rows } = await db.execute(sql`SELECT COUNT(*)::int AS c FROM schema_migrations`);
  const existingCount = (rows[0] as Record<string, number>).c;

  if (existingCount === 0) {
    const { readdirSync } = await import("fs");
    const { resolve }     = await import("path");
    const files = readdirSync(resolve(process.cwd(), "scripts"))
      .filter((f: string) => /^migrate-\d+.*\.ts$/.test(f))
      .sort();

    for (const file of files) {
      await db.execute(sql`
        INSERT INTO schema_migrations (filename) VALUES (${file})
        ON CONFLICT DO NOTHING
      `);
    }

    if (files.length > 0) {
      console.log(`  Pre-marked ${files.length} migration(s) as applied (fresh install — schema already current).`);
    }
  }

  console.log("  Database schema ready.");
}

// Standalone runner (npm run db:create)
if (process.argv[1]?.endsWith("create-schema.ts") || process.argv[1]?.endsWith("create-schema.js")) {
  createSchema()
    .then(() => process.exit(0))
    .catch(err => {
      console.error("Schema creation failed:", err);
      process.exit(1);
    });
}
