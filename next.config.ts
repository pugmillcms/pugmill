import type { NextConfig } from "next";

// ── Image remote patterns ──────────────────────────────────────────────────────
// Always allow OAuth avatar providers used by NextAuth.
const remotePatterns: NextConfig["images"] extends { remotePatterns?: infer R } ? NonNullable<R> : never[] = [
  {
    protocol: "https",
    hostname: "avatars.githubusercontent.com",
  },
  {
    protocol: "https",
    hostname: "lh3.googleusercontent.com",
  },
  // Supabase Storage — covers any project using Supabase as the S3 provider
  {
    protocol: "https",
    hostname: "*.supabase.co",
    pathname: "/storage/v1/object/public/**",
  },
];

// If S3_PUBLIC_URL is set, parse it and allow that bucket hostname.
// Example values: "https://my-bucket.s3.amazonaws.com"
//                 "https://cdn.example.com"
if (process.env.S3_PUBLIC_URL) {
  try {
    const s3Url = new URL(process.env.S3_PUBLIC_URL);
    remotePatterns.push({
      protocol: s3Url.protocol.replace(":", "") as "https" | "http",
      hostname: s3Url.hostname,
      // Include port only when non-standard (e.g. local MinIO)
      ...(s3Url.port ? { port: s3Url.port } : {}),
      // Lock to the bucket path prefix when present (e.g. "/my-bucket/**")
      ...(s3Url.pathname && s3Url.pathname !== "/" ? { pathname: `${s3Url.pathname}/**` } : {}),
    });
  } catch {
    console.warn(
      "[Pugmill] S3_PUBLIC_URL is set but could not be parsed as a URL — remote image pattern skipped.",
      process.env.S3_PUBLIC_URL
    );
  }
}

// ── Server Action origin allowlist ────────────────────────────────────────────
// Next.js 13.4+ enforces a same-origin check on Server Action POSTs by
// comparing the Origin header against the host. On platforms where a reverse
// proxy sits in front of the app (Replit with a custom domain, Vercel, etc.)
// the internal host header can differ from the public origin, and Next.js
// rejects the request. We allowlist the production hostname (derived from
// PRODUCTION_URL or NEXTAUTH_URL at build time — both are Replit Secrets) so
// custom-domain deployments work end-to-end. Without this, /setup form POSTs
// and other Server Action submissions can be rejected, sometimes manifesting
// as ECONNRESET when the proxy closes the connection mid-flight.
function extractHostname(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const url = rawUrl.startsWith("http") ? new URL(rawUrl) : new URL(`https://${rawUrl}`);
    return url.hostname || null;
  } catch {
    return null;
  }
}

const serverActionAllowedOrigins = [
  extractHostname(process.env.PRODUCTION_URL),
  extractHostname(process.env.NEXTAUTH_URL),
  // Replit's auto-injected dev domain for the preview pane during npm run dev.
  process.env.REPLIT_DEV_DOMAIN || null,
].filter((host): host is string => !!host);

// ── Content Security Policy ─────────────────────────────────────────────────────
// Pragmatic, app-wide policy. The high-value wins here are object-src 'none'
// (no plugin/embeds), base-uri 'self' (no <base> hijack), frame-ancestors
// (clickjacking) and form-action 'self' (no cross-origin form exfil).
//
// script-src keeps 'unsafe-inline' because Next's App Router emits inline
// bootstrap scripts and we don't (yet) thread a per-request nonce. That means
// this CSP is NOT a complete inline-XSS shield — a nonce-based policy via
// middleware is the follow-up. 'unsafe-eval' / ws: are added in dev only
// (React Refresh / HMR need them); production omits them.
const isDev = process.env.NODE_ENV !== "production";

const APP_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self' https:${isDev ? " ws: wss:" : ""}`,
].join("; ");

// Strict, locked-down policy for user-uploaded files served from /uploads.
// `sandbox` makes the browser treat a directly-navigated upload as a sandboxed
// document with a unique origin and no script execution — so even a malicious
// SVG/HTML upload can't run JS in the site's origin. Belt-and-suspenders with
// the SVG upload block in src/lib/actions/media.ts.
const UPLOADS_CSP = "default-src 'none'; sandbox; style-src 'unsafe-inline'; img-src 'self'";

// ── Config ────────────────────────────────────────────────────────────────────

const nextConfig: NextConfig = {
  // Hide the Next.js dev-mode indicator (the ▲/N badge that appears in the corner)
  devIndicators: false,

  // Allow proxied preview domains (Replit, Railway, Render, etc.) to load dev assets
  // without cross-origin warnings. No-op when the env var is absent.
  ...(process.env.REPLIT_DEV_DOMAIN
    ? { allowedDevOrigins: [process.env.REPLIT_DEV_DOMAIN] }
    : {}),

  images: {
    remotePatterns,
  },

  experimental: {
    serverActions: {
      // 4.5 MB ceiling on form-data Server Actions. Most managed platforms
      // cap request bodies around this value; matching it gives the app a
      // chance to reject oversized requests with a clean error rather than
      // letting the platform return a cryptic 413.
      bodySizeLimit: "4.5mb",
      // Allowlist derived from PRODUCTION_URL / NEXTAUTH_URL / REPLIT_DEV_DOMAIN
      // (see comment above the const). Empty array is the default same-origin
      // behaviour — no risk of weakening security when no envs are set.
      ...(serverActionAllowedOrigins.length > 0
        ? { allowedOrigins: serverActionAllowedOrigins }
        : {}),
    },
  },

  // Explicitly set the project root to prevent Turbopack from misdetecting
  // src/app as the workspace root (Next.js 16 moved turbopack to top-level).
  turbopack: {
    root: process.cwd(),
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: APP_CSP,
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            // Tell browsers to use HTTPS for 2 years, including subdomains.
            // Only effective on HTTPS deployments — ignored over HTTP.
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // Stricter headers for admin routes
        source: "/admin/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
        ],
      },
      {
        // User-uploaded files: sandbox so a malicious upload can't execute as a
        // same-origin document. CSP on a sub-resource (e.g. <img>) is ignored by
        // browsers, so embedding still works — this only bites direct navigation.
        source: "/uploads/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: UPLOADS_CSP,
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
