import { LRUCache } from "lru-cache";
import { db } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

type Options = {
  uniqueTokenPerInterval?: number;
  interval?: number; // ms
};

/**
 * Simple in-process rate limiter.
 * Tracks attempts per key (IP or email) using an LRU cache.
 * Suitable for single-server deployments. For multi-server, use Redis.
 */
export function createRateLimiter(options?: Options) {
  const tokenCache = new LRUCache<string, number[]>({
    max: options?.uniqueTokenPerInterval ?? 500,
    ttl: options?.interval ?? 60_000,
  });

  return {
    /**
     * Check if key has exceeded the limit.
     * @returns { success: true } if allowed, { success: false, remaining: 0 } if blocked
     */
    check(key: string, limit: number): { success: boolean; remaining: number } {
      const now = Date.now();
      const windowStart = now - (options?.interval ?? 60_000);

      const attempts = (tokenCache.get(key) ?? []).filter(t => t > windowStart);
      attempts.push(now);
      tokenCache.set(key, attempts);

      const remaining = Math.max(0, limit - attempts.length);
      return {
        success: attempts.length <= limit,
        remaining,
      };
    },

    /** Clear all attempts for a key (e.g. on successful login) */
    reset(key: string) {
      tokenCache.delete(key);
    },
  };
}

// Login rate limiter: max 5 attempts per 15 minutes per email
export const loginLimiter = createRateLimiter({
  interval: 15 * 60 * 1000, // 15 minutes
  uniqueTokenPerInterval: 1000,
});

// Global IP limiter: max 20 attempts per 15 minutes per IP
export const ipLoginLimiter = createRateLimiter({
  interval: 15 * 60 * 1000,
  uniqueTokenPerInterval: 500,
});

// Public form submission limiter: max 5 submissions per 10 minutes per IP.
// Applied to contact form and comment submissions to slow bot flooding.
export const submissionLimiter = createRateLimiter({
  interval: 10 * 60 * 1000, // 10 minutes
  uniqueTokenPerInterval: 2000,
});

export const SUBMISSION_RATE_LIMIT = 5;

// ─── AI usage rate limiter ─────────────────────────────────────────────────
// Per-user hourly call counter stored in the ai_usage DB table.
// One row per user; the window resets after 1 hour.
//
// Warning tiers:
//   0–19  green   (all good)
//   20–29 amber   (heads up)
//   30–39 orange  (slowing down)
//   40–49 red     (almost at limit)
//   50    blocked (try again in < 1 hour)

export const AI_RATE_LIMIT  = 50;
export const AI_RATE_WINDOW = 60 * 60 * 1000; // 1 hour in ms

export interface AiUsageResult {
  allowed: boolean;
  count:   number;
  limit:   number;
}

/**
 * Atomically increment the AI call counter for this user.
 * Resets the window if it expired. Returns the new count and whether allowed.
 */
export async function checkAndIncrementAi(userId: string): Promise<AiUsageResult> {
  const now          = new Date();
  const windowCutoff = new Date(now.getTime() - AI_RATE_WINDOW);

  await db.execute(
    sql`INSERT INTO ai_usage (user_id, window_start, count)
        VALUES (${userId}, ${now}, 1)
        ON CONFLICT (user_id) DO UPDATE SET
          count       = CASE WHEN ai_usage.window_start < ${windowCutoff} THEN 1 ELSE ai_usage.count + 1 END,
          window_start = CASE WHEN ai_usage.window_start < ${windowCutoff} THEN ${now} ELSE ai_usage.window_start END`,
  );

  const rows  = await db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
  const count = rows[0]?.count ?? 1;
  return { allowed: count <= AI_RATE_LIMIT, count, limit: AI_RATE_LIMIT };
}

/**
 * Read the current AI usage without incrementing.
 * Returns count: 0 if the window has expired or no record exists.
 */
export async function getAiUsage(userId: string): Promise<{ count: number; limit: number }> {
  const windowCutoff = new Date(Date.now() - AI_RATE_WINDOW);
  const rows = await db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
  const row  = rows[0];
  if (!row || row.windowStart < windowCutoff) return { count: 0, limit: AI_RATE_LIMIT };
  return { count: row.count, limit: AI_RATE_LIMIT };
}

// Public API rate limiter: max 60 requests per minute per IP
export const apiLimiter = createRateLimiter({
  interval: 60_000, // 1 minute
  uniqueTokenPerInterval: 2000, // track up to 2000 unique IPs per window
});

const API_RATE_LIMIT = 60;

/**
 * Check the public API rate limit for a request (Node.js runtime only — NOT Edge).
 * Returns a 429 Response if the IP has exceeded the limit, or null if the request is allowed.
 *
 * Usage:
 *   const limited = checkApiRateLimit(req);
 *   if (limited) return limited;
 */
export function checkApiRateLimit(req: { headers: { get(name: string): string | null } }): Response | null {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const { success, remaining } = apiLimiter.check(ip, API_RATE_LIMIT);

  if (!success) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: {
        "Content-Type": "text/plain",
        "Retry-After": "60",
        "X-RateLimit-Limit": String(API_RATE_LIMIT),
        "X-RateLimit-Remaining": "0",
      },
    });
  }

  // Attach informational headers to the caller's response if needed:
  //   res.headers.set("X-RateLimit-Limit", String(API_RATE_LIMIT));
  //   res.headers.set("X-RateLimit-Remaining", String(remaining));
  void remaining;
  return null;
}
