import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getConfig } from "@/lib/config";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { resolveSiteUrl, toAbsoluteUrl } from "@/lib/site-url";
import { RenderedPage } from "../_render-page";

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const [page, config] = await Promise.all([
    db.query.posts.findFirst({
      where: and(eq(posts.slug, slug), eq(posts.type, "page"), eq(posts.published, true)),
    }),
    getConfig(),
  ]);

  const siteName = config.site?.name ?? "Pugmill";
  if (!page) return { title: "Not found" };

  const siteUrl = resolveSiteUrl(
    process.env.NEXTAUTH_URL ?? "http://localhost:3000",
    config.site?.url ?? "",
  );
  const seoTitle = page.seoTitle;
  const seoMetaDescription = page.seoMetaDescription;
  const defaultDescription = page.excerpt ?? config.site.seoDefaults?.metaDescription ?? undefined;
  const canonicalUrl = (page.canonicalUrl && page.canonicalUrl.trim())
    ? page.canonicalUrl
    : `${siteUrl}/${page.slug}`;
  const ogImage =
    toAbsoluteUrl(page.ogImageUrl, siteUrl) ??
    toAbsoluteUrl(config.site.seoDefaults?.ogImage, siteUrl) ??
    undefined;

  const robotsDirectives: string[] = [];
  if (page.robotsNoindex) robotsDirectives.push("noindex");
  if (page.robotsNofollow) robotsDirectives.push("nofollow");

  return {
    title: seoTitle ? { absolute: seoTitle } : page.title,
    description: seoMetaDescription ?? defaultDescription,
    ...(robotsDirectives.length ? { robots: robotsDirectives.join(", ") } : {}),
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: seoTitle ?? page.title,
      description: seoMetaDescription ?? defaultDescription,
      url: canonicalUrl,
      ...(ogImage ? { images: [{ url: ogImage, alt: page.title }] } : {}),
    },
  };
}

// ─── Page component ───────────────────────────────────────────────────────────

export default async function GenericPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const page = await db.query.posts.findFirst({
    where: and(eq(posts.slug, slug), eq(posts.type, "page"), eq(posts.published, true)),
  });

  if (!page) notFound();

  const [config, cookieStore] = await Promise.all([getConfig(), cookies()]);
  const isPreview = cookieStore.get("__pugmill_design_preview")?.value === "1";

  return <RenderedPage page={page} config={config} isPreview={isPreview} />;
}
