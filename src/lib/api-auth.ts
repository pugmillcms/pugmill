import crypto from "crypto";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { createRateLimiter } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";

// Authenticated API requests get 10× the public limit.
const AUTHED_RATE_LIMIT = 600; // req/min
const authedLimiter = createRateLimiter({ interval: 60_000, uniqueTokenPerInterval: 500 });

export type ApiScope = "read" | "readwrite";

export type ApiAuthResult =
  | { ok: true; authenticated: false }
  | { ok: true; authenticated: true; keyId: number; scope: ApiScope }
  | { ok: false; response: Response };

/**
 * authorizeApiRequest
 *
 * Call at the top of every public API route handler in place of checkApiRateLimit().
 *
 * - No Authorization header → falls through to IP-based rate limiting (60 req/min).
 * - Authorization: Bearer <token> present but invalid → 401.
 * - Valid token but revoked → 401.
 * - Valid active token → 600 req/min per key, lastUsedAt updated fire-and-forget.
 *
 * Usage:
 *   const auth = await authorizeApiRequest(req);
 *   if (!auth.ok) return auth.response;
 */
export async function authorizeApiRequest(req: Request): Promise<ApiAuthResult> {
  const authHeader = req.headers.get("authorization");

  if (!authHeader) {
    // No key — apply public IP rate limit (60/min). Shared helper, same
    // derivation as every other rate-limited surface.
    const ip = getClientIp(req.headers);

    const PUBLIC_LIMIT = 60;
    const { success } = authedLimiter.check(`ip:${ip}`, PUBLIC_LIMIT);
    if (!success) {
      return {
        ok: false,
        response: new Response("Too Many Requests", {
          status: 429,
          headers: { "Content-Type": "text/plain", "Retry-After": "60" },
        }),
      };
    }
    return { ok: true, authenticated: false };
  }

  // Extract Bearer token
  const match = authHeader.match(/^Bearer\s+(pm_[0-9a-f]{64})$/i);
  if (!match) {
    return {
      ok: false,
      response: new Response("Unauthorized: invalid token format", { status: 401 }),
    };
  }

  const token = match[1];
  const hash = crypto.createHash("sha256").update(token).digest("hex");

  const row = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, hash) });

  if (!row) {
    return {
      ok: false,
      response: new Response("Unauthorized: unknown API key", { status: 401 }),
    };
  }

  if (row.revokedAt) {
    return {
      ok: false,
      response: new Response("Unauthorized: API key has been revoked", { status: 401 }),
    };
  }

  // Per-key rate limit (600/min)
  const { success } = authedLimiter.check(`key:${row.id}`, AUTHED_RATE_LIMIT);
  if (!success) {
    return {
      ok: false,
      response: new Response("Too Many Requests", {
        status: 429,
        headers: { "Content-Type": "text/plain", "Retry-After": "60" },
      }),
    };
  }

  // Update lastUsedAt fire-and-forget — never block the response on this.
  // Using sql`` bypasses Drizzle's strict set() type inference for nullable timestamps.
  db.execute(sql`UPDATE api_keys SET last_used_at = NOW() WHERE id = ${row.id}`)
    .catch(() => { /* non-critical */ });

  const scope: ApiScope = row.scope === "readwrite" ? "readwrite" : "read";
  return { ok: true, authenticated: true, keyId: row.id, scope };
}

/**
 * generateApiToken
 *
 * Returns a new { token, hash, prefix } triple.
 * Called server-side only — token is shown to the user once and discarded.
 */
export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const raw = crypto.randomBytes(32).toString("hex"); // 64 hex chars
  const token = `pm_${raw}`;
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const prefix = token.slice(0, 11); // "pm_" + first 8 hex chars
  return { token, hash, prefix };
}
