/**
 * detect-site-url.ts
 *
 * Detects the best available public URL for this deployment from
 * trusted platform-injected environment variables.
 *
 * Priority order:
 *   1. NEXTAUTH_URL                   — explicit override, always wins
 *   2. REPLIT_DEV_DOMAIN              — Replit (set by replit-init.ts before server starts)
 *   3. VERCEL_PROJECT_PRODUCTION_URL  — Vercel stable production URL (no protocol)
 *   4. RAILWAY_PUBLIC_DOMAIN          — Railway (hostname only, no protocol)
 *   5. RENDER_EXTERNAL_URL            — Render (full https:// URL)
 *   6. null                           — unknown host; caller falls back to localhost
 *
 * Security note: all vars here are injected by trusted infrastructure,
 * never derived from HTTP request headers. Auto-detection from these
 * sources is safe for use as NEXTAUTH_URL / config.site.url.
 */
export function detectSiteUrl(): string | null {
  const e = process.env;

  if (e.NEXTAUTH_URL)
    return e.NEXTAUTH_URL;

  if (e.REPLIT_DEV_DOMAIN)
    return `https://${e.REPLIT_DEV_DOMAIN}`;

  if (e.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${e.VERCEL_PROJECT_PRODUCTION_URL}`;

  if (e.RAILWAY_PUBLIC_DOMAIN)
    return `https://${e.RAILWAY_PUBLIC_DOMAIN}`;

  if (e.RENDER_EXTERNAL_URL)
    return e.RENDER_EXTERNAL_URL; // already includes https://

  return null;
}

/**
 * Returns true when the given URL looks like a local dev address or
 * an uninitialized placeholder. Used to decide whether to show the
 * "configure your production URL" warning banner in the admin.
 */
export function isDevUrl(url: string): boolean {
  return (
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url) ||
    url.includes(".replit.dev") ||
    url.includes(".repl.co")
  );
}
