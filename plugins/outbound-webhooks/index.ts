import type { PugmillPlugin } from "../../src/lib/plugin-registry";
import { db } from "../../src/lib/db";
import { sql } from "drizzle-orm";
import { pluginWebhooksEndpoints, pluginWebhooksDeliveries } from "./schema";
import { getEndpointsForEvent, logDelivery } from "./db";
import AdminPage from "./components/AdminPage";
import crypto from "crypto";

/**
 * Dispatch a webhook payload to a single endpoint.
 * Signs the payload with HMAC-SHA256 when a secret is configured.
 * Logs the result. Never throws.
 */
async function dispatch(
  endpoint: typeof pluginWebhooksEndpoints.$inferSelect,
  event: string,
  data: unknown,
): Promise<void> {
  const payload = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent":   "Pugmill-Webhooks/1.0",
    "X-Pugmill-Event": event,
  };

  if (endpoint.secret) {
    try {
      const { decryptString } = await import("../../src/lib/encrypt");
      const secret = decryptString(endpoint.secret);
      if (secret) {
        const sig = crypto
          .createHmac("sha256", secret)
          .update(payload)
          .digest("hex");
        headers["X-Pugmill-Signature"] = `sha256=${sig}`;
      }
    } catch {
      // Signing failed — deliver unsigned rather than drop
    }
  }

  let status: "success" | "failed" = "failed";
  let responseCode: number | undefined;
  let error: string | undefined;

  try {
    // Re-validate at dispatch time: the URL passed the SSRF check when saved,
    // but DNS can change. Block anything that now resolves to a private host.
    const { assertPublicHttpUrl } = await import("../../src/lib/ssrf");
    await assertPublicHttpUrl(endpoint.url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    responseCode = res.status;
    status = res.ok ? "success" : "failed";
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : "Unknown error";
    if (error.includes("abort")) error = "Timeout (10s)";
  }

  await logDelivery({ endpointId: endpoint.id, event, payload, status, responseCode, error });
}

/**
 * Dispatch an event to all matching active endpoints. Fire-and-forget.
 */
async function fireEvent(event: string, data: unknown): Promise<void> {
  try {
    const endpoints = await getEndpointsForEvent(event);
    await Promise.allSettled(endpoints.map((ep) => dispatch(ep, event, data)));
  } catch {
    // Never surface webhook errors to the user
  }
}

export const outboundWebhooksPlugin: PugmillPlugin = {
  id:          "outbound-webhooks",
  name:        "Outbound Webhooks",
  version:     "1.0.0",
  description: "Delivers signed JSON payloads to external URLs when CMS events occur.",

  schema: {
    async migrate() {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS plugin_webhooks_endpoints (
          id          SERIAL PRIMARY KEY,
          name        TEXT    NOT NULL,
          url         TEXT    NOT NULL,
          secret      TEXT    NOT NULL DEFAULT '',
          events      TEXT    NOT NULL DEFAULT '["*"]',
          active      BOOLEAN NOT NULL DEFAULT TRUE,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS plugin_webhooks_deliveries (
          id            SERIAL PRIMARY KEY,
          endpoint_id   INTEGER     NOT NULL,
          event         VARCHAR(100) NOT NULL,
          payload       TEXT        NOT NULL,
          status        VARCHAR(20) NOT NULL,
          response_code INTEGER,
          error         TEXT,
          delivered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS plugin_webhooks_deliveries_endpoint_id_idx
          ON plugin_webhooks_deliveries (endpoint_id, delivered_at DESC)
      `);
    },
    async teardown() {
      await db.execute(sql`DROP TABLE IF EXISTS plugin_webhooks_deliveries`);
      await db.execute(sql`DROP TABLE IF EXISTS plugin_webhooks_endpoints`);
    },
  },

  adminPage: AdminPage,

  async initialize(hooks) {
    hooks.addAction("post:after-save",      ({ post })     => void fireEvent("post:after-save", post));
    hooks.addAction("post:after-publish",   ({ post })     => void fireEvent("post:after-publish", post));
    hooks.addAction("post:before-delete",   ({ postId })   => void fireEvent("post:before-delete", { postId }));
    hooks.addAction("media:after-upload",   ({ file })     => void fireEvent("media:after-upload", file));
    hooks.addAction("media:after-delete",   ({ fileId })   => void fireEvent("media:after-delete", { fileId }));
    hooks.addAction("comment:after-create", ({ comment })  => void fireEvent("comment:after-create", comment));
    hooks.addAction("comment:after-approve",({ commentId, approved }) =>
      void fireEvent("comment:after-approve", { commentId, approved }));
  },
};
