/**
 * Migration 010 — Add scope column to api_keys
 *
 * API keys gain a permission scope: "read" (REST API + read-only MCP tools) or
 * "readwrite" (also allows content-mutating MCP tools). Existing keys default
 * to "read" — the safe choice — so no key silently gains write access on upgrade.
 *
 * Safe to run multiple times (ADD COLUMN IF NOT EXISTS guard).
 *
 * Run via: npm run db:migrate
 */
import { existsSync } from "fs";
import { config } from "dotenv";
if (existsSync(".env.local")) config({ path: ".env.local" });

import { db } from "../src/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Migration 010: adding api_keys.scope column...");

  await db.execute(sql`
    ALTER TABLE "api_keys"
      ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'read'
  `);

  console.log("Migration 010: done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration 010 failed:", err);
  process.exit(1);
});
