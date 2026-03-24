import { db } from "@/lib/db";
import { tags } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getConfig } from "@/lib/config";
import { sanitizeThemeName } from "@/lib/theme-registry";
import { getDesignConfig } from "@/lib/design-config";
import { getThemeHomeView } from "@/lib/theme-modules";
import { fetchPostPage } from "@/lib/queries/posts";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import type { HomeLayoutConfig } from "../../../../../themes/default/design";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const [tag, config, postPage] = await Promise.all([
    db.query.tags.findFirst({ where: eq(tags.slug, slug) }),
    getConfig(),
    fetchPostPage({ page, tagSlug: slug }),
  ]);

  if (!tag) return { title: "Tag not found" };

  const siteUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const siteName = config.site?.name ?? "Pugmill";
  const title = `#${tag.name} · ${siteName}`;
  const description = `Posts tagged ${tag.name}`;

  const canonical = page === 1 ? `${siteUrl}/tag/${slug}` : `${siteUrl}/tag/${slug}?page=${page}`;
  const prev = page > 1 ? (page === 2 ? `${siteUrl}/tag/${slug}` : `${siteUrl}/tag/${slug}?page=${page - 1}`) : undefined;
  const next = page < postPage.totalPages ? `${siteUrl}/tag/${slug}?page=${page + 1}` : undefined;

  return {
    title,
    description,
    alternates: { canonical, ...(prev ? { prev } : {}), ...(next ? { next } : {}) },
    openGraph: { type: "website", title, description, url: canonical, siteName },
  };
}

export default async function TagArchivePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ slug }, sp, config, cookieStore] = await Promise.all([
    params,
    searchParams,
    getConfig(),
    cookies(),
  ]);

  const tag = await db.query.tags.findFirst({ where: eq(tags.slug, slug) });
  if (!tag) notFound();

  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const activeTheme = sanitizeThemeName(config.appearance.activeTheme);

  const isPreview = cookieStore.get("__pugmill_design_preview")?.value === "1";
  const designConfig = await getDesignConfig(activeTheme, isPreview ? "draft" : "published");

  const layoutConfig: HomeLayoutConfig = {
    feedStyle: (designConfig.homeFeedStyle as "list" | "grid") ?? "list",
    listStyle: (designConfig.homeListStyle as "compact" | "editorial" | "feature" | "text-only") ?? "compact",
    columns: (Number(designConfig.homeColumns) as 1 | 2 | 3) ?? 1,
    gap: (designConfig.homeGap as "sm" | "md" | "lg") ?? "md",
  };

  const postPage = await fetchPostPage({ page, tagSlug: slug });
  const HomeView = getThemeHomeView(activeTheme);

  return (
    <HomeView
      posts={postPage.posts}
      layoutConfig={layoutConfig}
      pagination={{ page: postPage.page, totalPages: postPage.totalPages }}
      heading={`#${tag.name}`}
      subheading={`All posts tagged ${tag.name}`}
    />
  );
}
