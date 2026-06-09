import { db } from "@/lib/db";
import { siteConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { detectSiteUrl } from "@/lib/detect-site-url";

// ─── Schema ──────────────────────────────────────────────────────────────────

const navItemSchema = z.object({
  label: z.string(),
  path: z.string(),
});

/** Accepts a relative path (/...) or an http(s) absolute URL. Blocks javascript: and other schemes. */
const urlOrPathSchema = z
  .string()
  .optional()
  .refine(
    (val) => !val || val.startsWith("/") || /^https?:\/\//i.test(val),
    "Must be a relative path (starting with /) or an https:// URL"
  );

export const configSchema = z.object({
  site: z.object({
    name: z.string(),
    description: z.string(),
    url: z.string(),
    logo: urlOrPathSchema,
    favicon: urlOrPathSchema,
    headerIdentity: z.enum(["logo-only", "name-only", "logo-and-name"]).default("logo-only"),
    socialLinks: z.preprocess(
      (val) => {
        // Coerce legacy flat-object format → new array format on first read
        if (val && typeof val === "object" && !Array.isArray(val)) {
          return Object.entries(val as Record<string, string>)
            .filter(([, url]) => !!url)
            .map(([platform, url]) => ({ platform, url }));
        }
        return val;
      },
      z.array(z.object({ platform: z.string(), url: z.string() })).default([])
    ),
    seoDefaults: z.object({
      ogImage: urlOrPathSchema,
      metaDescription: z.string().optional(), // Fallback meta description
      blockAiBots: z.boolean().default(false),
      robotsCustomRules: z.string().optional(), // Extra Disallow/Allow lines appended verbatim
    }).default({}),
    showPoweredBy: z.boolean().default(true),
    adminAnnouncement: z.string().optional(),
    aeoDefaults: z.object({
      summary: z.string().optional(),
      questions: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
      organization: z.object({
        name: z.string().optional(),
        type: z.string().optional(),
        description: z.string().optional(),
        url: z.string().optional(),
      }).optional(),
    }).default({}),
  }),
  appearance: z.object({
    activeTheme: z.string().regex(/^[a-z0-9-]+$/, "Theme name must be alphanumeric").default("default"),
    navigation: z.array(navItemSchema).default([]),
    footerNavigation: z.array(navItemSchema).default([]),
  }),
  modules: z.object({
    activePlugins: z.array(z.string()).default([]),
    pluginSettings: z.record(
      z.string(),
      z.record(z.string(), z.union([z.string(), z.boolean()]))
    ).default({}),
  }),
  system: z.object({
    version: z.string(),
    headlessMode: z.boolean().default(false),
    maintenanceMode: z.boolean().default(false),
  }),
  ai: z.object({
    provider: z.enum(["anthropic", "openai", "gemini"]).nullable().default(null),
    apiKey: z.string().default(""),
    model: z.string().default(""),
    aiRateLimit: z.number().int().min(1).max(500).default(50),
  }).default({ provider: null, apiKey: "", model: "", aiRateLimit: 50 }),
  storage: z.object({
    /** "local" saves to /public/uploads (ephemeral on Replit). "s3" uses any S3-compatible store. */
    provider: z.enum(["local", "s3"]).default("local"),
    bucket: z.string().default(""),
    region: z.string().default("auto"),
    /** Access key ID — stored encrypted. */
    accessKeyId: z.string().default(""),
    /** Secret access key — stored encrypted. */
    secretAccessKey: z.string().default(""),
    /** Custom endpoint URL for R2, DigitalOcean Spaces, MinIO, etc. Leave blank for AWS. */
    endpoint: z.string().default(""),
    /** Base URL for public file access. Defaults to the S3 bucket URL if blank. */
    publicUrl: z.string().default(""),
    /** Set false for R2 / private buckets (omits ACL header). True = public-read for AWS. */
    publicAcl: z.boolean().default(false),
  }).default({
    provider: "local", bucket: "", region: "auto",
    accessKeyId: "", secretAccessKey: "", endpoint: "", publicUrl: "", publicAcl: false,
  }),
  auth: z.object({
    /** Google OAuth client ID (public). */
    googleClientId: z.string().default(""),
    /** Google OAuth client secret — stored encrypted. */
    googleClientSecret: z.string().default(""),
    /** GitHub OAuth client ID (public). */
    githubClientId: z.string().default(""),
    /** GitHub OAuth client secret — stored encrypted. */
    githubClientSecret: z.string().default(""),
    /**
     * Emails permitted to self-provision via OAuth. A new GitHub/Google identity
     * is created as an editor ONLY if its email is listed here (or its domain is
     * in oauthAllowedDomains). The first account on an empty install is always
     * allowed (bootstrap). Empty = no new OAuth users (existing users still log in).
     */
    oauthAllowedEmails: z.array(z.string()).default([]),
    /** Domains (e.g. "example.com") whose emails may self-provision via OAuth. */
    oauthAllowedDomains: z.array(z.string()).default([]),
  }).default({
    googleClientId: "", googleClientSecret: "", githubClientId: "", githubClientSecret: "",
    oauthAllowedEmails: [], oauthAllowedDomains: [],
  }),
  network: z.object({
    /** Whether this site participates in the AEO Intelligence Network. Off by default. */
    participateInNetwork: z.boolean().default(false),
    /**
     * Network token issued by aeopugmill.com — required to submit reports.
     * Stored encrypted at rest using AI_ENCRYPTION_KEY (same as ai.apiKey).
     */
    networkToken: z.string().default(""),
    /** ISO date string of the last successful submission — display only, not used in logic. */
    lastReportedAt: z.string().optional(),
  }).default({
    participateInNetwork: false,
    networkToken: "",
  }),
  email: z.object({
    provider: z.enum(["resend", "smtp"]).nullable().default(null),
    /** Display name used in the From header (e.g. "My Blog"). */
    fromName: z.string().default(""),
    /** Sender address (e.g. "noreply@yourdomain.com"). */
    fromAddress: z.string().default(""),
    /** Default destination for CMS notification emails (contact forms, etc.). */
    toAddress: z.string().default(""),
    /** Resend API key — stored encrypted with AI_ENCRYPTION_KEY. */
    apiKey: z.string().default(""),
    /** SMTP hostname */
    smtpHost: z.string().default(""),
    /** SMTP port (default 587) */
    smtpPort: z.number().int().min(1).max(65535).default(587),
    /** SMTP username */
    smtpUser: z.string().default(""),
    /** SMTP password — stored encrypted with AI_ENCRYPTION_KEY. */
    smtpPassword: z.string().default(""),
    /** Use TLS on connect (port 465). False = STARTTLS (port 587). */
    smtpSecure: z.boolean().default(false),
  }).default({
    provider: null,
    fromName: "", fromAddress: "", toAddress: "",
    apiKey: "",
    smtpHost: "", smtpPort: 587, smtpUser: "", smtpPassword: "", smtpSecure: false,
  }),
});

export type Config = z.infer<typeof configSchema>;

// ─── Default config (used as seed on first boot) ─────────────────────────────

const DEFAULT_CONFIG: Config = {
  site: {
    name: "My Pugmill Site",
    description: "A rebuildable CMS",
    url: "http://localhost:3000",
    socialLinks: [],
    seoDefaults: {},
    aeoDefaults: {},
  },
  appearance: {
    activeTheme: "default",
    navigation: [
      { label: "Home", path: "/" },
      { label: "Blog", path: "/blog" },
      { label: "About", path: "/about" },
    ],
  },
  modules: {
    activePlugins: [],
    pluginSettings: {},
  },
  system: {
    version: "0.1.0",
    headlessMode: false,
    maintenanceMode: false,
  },
  ai: { provider: null, apiKey: "", model: "", aiRateLimit: 50 },
  storage: {
    provider: "local", bucket: "", region: "auto",
    accessKeyId: "", secretAccessKey: "", endpoint: "", publicUrl: "", publicAcl: false,
  },
  network: {
    participateInNetwork: false,
    networkToken: "",
  },
  auth: {
    googleClientId: "", googleClientSecret: "", githubClientId: "", githubClientSecret: "",
    oauthAllowedEmails: [], oauthAllowedDomains: [],
  },
  email: {
    provider: null,
    fromName: "", fromAddress: "", toAddress: "",
    apiKey: "",
    smtpHost: "", smtpPort: 587, smtpUser: "", smtpPassword: "", smtpSecure: false,
  },
};

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Avoids a DB hit on every request. Invalidated on write or after TTL expires.
// TTL-based expiry prevents config drift across multi-instance / serverless
// deployments where each process has its own memory.
// For true real-time invalidation, replace with Redis pub/sub.

// 5 seconds: short enough that cross-instance staleness (warm containers)
// clears quickly after a write, but still avoids repeat DB hits within a single
// server-side render. Don't raise this — plugin toggles must be immediately
// consistent when the user navigates back.
const CACHE_TTL_MS = 5_000;

interface ConfigCache {
  value: Config;
  expiresAt: number; // Date.now() + TTL
}

let configCache: ConfigCache | null = null;

// ─── Seed from JSON file if it exists ────────────────────────────────────────

function loadSeedFromFile(): Config {
  const jsonPath = path.join(process.cwd(), "pugmill.config.json");
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      return configSchema.parse(raw);
    } catch {
      console.warn("[Pugmill] pugmill.config.json is invalid or unreadable. Using defaults.");
    }
  }
  return DEFAULT_CONFIG;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Read the CMS config from the database.
 * On first boot, seeds from pugmill.config.json (if present) or defaults.
 * Results are cached in memory until updateConfig() is called.
 */
export async function getConfig(): Promise<Config> {
  // Return cached value if still within TTL
  if (configCache && Date.now() < configCache.expiresAt) {
    return configCache.value;
  }

  try {
    const rows = await db.select().from(siteConfig).where(eq(siteConfig.id, 1));

    if (rows.length === 0) {
      // First boot: seed from JSON file or defaults.
      // Use onConflictDoNothing to handle concurrent first-boot race conditions safely.
      const seed = loadSeedFromFile();

      // Auto-detect the public URL from trusted platform env vars so that
      // config.site.url reflects the real deployment URL from day one rather
      // than staying as the localhost placeholder.
      const detectedUrl = detectSiteUrl();
      if (detectedUrl && seed.site.url === DEFAULT_CONFIG.site.url) {
        seed.site.url = detectedUrl;
      }
      await db.insert(siteConfig).values({ id: 1, config: seed } as typeof siteConfig.$inferInsert).onConflictDoNothing();
      // Re-fetch in case another instance won the race and inserted a different seed.
      const refetch = await db.select().from(siteConfig).where(eq(siteConfig.id, 1));
      const seeded = refetch.length > 0
        ? (configSchema.safeParse(refetch[0].config).data ?? seed)
        : seed;
      configCache = { value: seeded, expiresAt: Date.now() + CACHE_TTL_MS };
      console.log("[Pugmill] Config seeded to database.");
      return seeded;
    }

    const parsed = configSchema.safeParse(rows[0].config);
    if (!parsed.success) {
      console.error("[Pugmill] Config in database is invalid. Using defaults.", parsed.error.issues);
      configCache = { value: DEFAULT_CONFIG, expiresAt: Date.now() + CACHE_TTL_MS };
      return DEFAULT_CONFIG;
    }

    configCache = { value: parsed.data, expiresAt: Date.now() + CACHE_TTL_MS };
    return parsed.data;
  } catch (err) {
    // DB unavailable (e.g. during build or test) — fall back to file or defaults.
    // Do not cache the fallback: retry DB on the next request.
    console.warn("[Pugmill] Could not read config from DB, using fallback.", err);
    return loadSeedFromFile();
  }
}

/**
 * Write updated config to the database.
 * Validates with Zod before writing. Clears in-memory cache.
 */
export async function updateConfig(newConfig: unknown): Promise<void> {
  const validated = configSchema.parse(newConfig);

  await db
    .insert(siteConfig)
    .values({ id: 1, config: validated } as typeof siteConfig.$inferInsert)
    .onConflictDoUpdate({
      target: siteConfig.id,
      set: { config: validated, updatedAt: new Date() } as Partial<typeof siteConfig.$inferInsert>,
    });

  configCache = null; // Invalidate — next read will refetch and reset the TTL.
}

/**
 * Invalidate the in-memory config cache immediately.
 * The next call to getConfig() will refetch from the database.
 */
export function invalidateConfigCache(): void {
  configCache = null;
}
