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
    socialLinks: z.object({
      twitter: urlOrPathSchema,
      github: urlOrPathSchema,
      linkedin: urlOrPathSchema,
      instagram: urlOrPathSchema,
      youtube: urlOrPathSchema,
      facebook: urlOrPathSchema,
    }).default({}),
    seoDefaults: z.object({
      ogImage: urlOrPathSchema,
      metaDescription: z.string().optional(), // Fallback meta description
    }).default({}),
    showPoweredBy: z.boolean().default(true),
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
    onboardingDismissed: z.boolean().default(false),
  }),
  ai: z.object({
    provider: z.enum(["anthropic", "openai", "gemini"]).nullable().default(null),
    apiKey: z.string().default(""),
    model: z.string().default(""),
  }).default({ provider: null, apiKey: "", model: "" }),
});

export type Config = z.infer<typeof configSchema>;

// ─── Default config (used as seed on first boot) ─────────────────────────────

const DEFAULT_CONFIG: Config = {
  site: {
    name: "My Pugmill Site",
    description: "A rebuildable CMS",
    url: "http://localhost:3000",
    socialLinks: {},
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
    onboardingDismissed: false,
  },
  ai: { provider: null, apiKey: "", model: "" },
};

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Avoids a DB hit on every request. Invalidated on write or after TTL expires.
// TTL-based expiry prevents config drift across multi-instance / serverless
// deployments where each process has its own memory (e.g. Vercel functions).
// For true real-time invalidation, replace with Redis pub/sub.

const CACHE_TTL_MS = 60_000; // 60 seconds

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
