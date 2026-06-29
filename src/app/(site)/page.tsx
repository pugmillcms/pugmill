import { getConfig, type Config } from "@/lib/config";
import { sanitizeThemeName } from "@/lib/theme-registry";
import { getDesignConfig } from "@/lib/design-config";
import { getThemeSections } from "@/lib/theme-modules";
import { parseHomepageSections } from "@/lib/homepage-sections";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { resolveSiteUrl, toAbsoluteUrl } from "@/lib/site-url";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { RenderedPage } from "./_render-page";

// ─── Static front page resolution ───────────────────────────────────────────────
//
// When reading.homepageMode === "page", a specific published page acts as the
// homepage. If the selected page is missing/unpublished/deleted, this returns
// null and the homepage falls back to the theme's section stack — the site root
// must never 404.

async function resolveFrontPage(config: Config) {
  if (config.reading?.homepageMode !== "page" || config.reading.homepagePageId == null) {
    return null;
  }
  const page = await db.query.posts.findFirst({
    where: and(
      eq(posts.id, config.reading.homepagePageId),
      eq(posts.type, "page"),
      eq(posts.published, true),
    ),
  });
  return page ?? null;
}

// ─── Dynamic metadata ─────────────────────────────────────────────────────────

export async function generateMetadata(): Promise<Metadata> {
  const config = await getConfig();
  const siteUrl = resolveSiteUrl(
    process.env.NEXTAUTH_URL ?? "http://localhost:3000",
    config.site?.url ?? "",
  );
  const siteName = config.site?.name ?? "Pugmill";

  // In static-front-page mode, derive title/description/OG from the page, but
  // keep the canonical as the bare site URL so "/" and "/<slug>" don't compete.
  const frontPage = await resolveFrontPage(config);
  const title = frontPage?.seoTitle || frontPage?.title || siteName;
  const description =
    frontPage?.seoMetaDescription ||
    frontPage?.excerpt ||
    config.site?.description ||
    config.site?.seoDefaults?.metaDescription ||
    undefined;
  const ogImage =
    toAbsoluteUrl(frontPage?.ogImageUrl ?? config.site?.seoDefaults?.ogImage, siteUrl) ?? undefined;

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: siteUrl,
      types: { "application/rss+xml": `${siteUrl}/feed.xml` },
    },
    openGraph: {
      type: "website",
      title,
      description,
      url: siteUrl,
      siteName,
      ...(ogImage ? { images: [{ url: ogImage, alt: title }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const [config, sp, cookieStore] = await Promise.all([
    getConfig(),
    searchParams,
    cookies(),
  ]);

  const isPreview = cookieStore.get("__pugmill_design_preview")?.value === "1";

  // Static front page: a specific published page acts as the homepage.
  const frontPage = await resolveFrontPage(config);
  if (frontPage) {
    return <RenderedPage page={frontPage} config={config} isPreview={isPreview} />;
  }

  // Default: render the active theme's homepage section stack.
  // Each theme renders its sections with its own card components and layout.
  // Core has no knowledge of what's inside — it just passes the data.
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const activeTheme = sanitizeThemeName(config.appearance.activeTheme);
  const designConfig = await getDesignConfig(activeTheme, isPreview ? "draft" : "published");
  const sections = parseHomepageSections(designConfig);
  const ThemeSections = getThemeSections(activeTheme);

  return <ThemeSections sections={sections} page={page} />;
}
