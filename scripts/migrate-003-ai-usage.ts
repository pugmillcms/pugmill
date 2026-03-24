/**
 * Migration 003 — Add ai_usage table
 *
 * Adds the per-user hourly AI call counter table used by the AI rate limiter.
 * Safe to run multiple times (IF NOT EXISTS guard).
 *
 * Run via: npm run db:migrate
 */
import { existsSync } from "fs";
import { config } from "dotenv";
if (existsSync(".env.local")) config({ path: ".env.local" });

import { db } from "../src/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Migration 003: adding ai_usage table...");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ai_usage (
      user_id      TEXT        PRIMARY KEY,
      window_start TIMESTAMP   NOT NULL DEFAULT NOW(),
      count        INTEGER     NOT NULL DEFAULT 0
    )
  `);

  console.log("Migration 003: done.");
  process.exit(0);
}

main().catch(err => {
  console.error("Migration 003 failed:", err);
  process.exit(1);
});
