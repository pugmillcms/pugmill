import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
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
  const [cat, config, postPage] = await Promise.all([
    db.query.categories.findFirst({ where: eq(categories.slug, slug) }),
    getConfig(),
    fetchPostPage({ page, categorySlug: slug }),
  ]);

  if (!cat) return { title: "Category not found" };

  const siteUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const siteName = config.site?.name ?? "Pugmill";
  const title = `${cat.name} · ${siteName}`;
  const description = cat.description || `Posts in ${cat.name}`;

  const canonical = page === 1 ? `${siteUrl}/category/${slug}` : `${siteUrl}/category/${slug}?page=${page}`;
  const prev = page > 1 ? (page === 2 ? `${siteUrl}/category/${slug}` : `${siteUrl}/category/${slug}?page=${page - 1}`) : undefined;
  const next = page < postPage.totalPages ? `${siteUrl}/category/${slug}?page=${page + 1}` : undefined;

  return {
    title,
    description,
    alternates: { canonical, ...(prev ? { prev } : {}), ...(next ? { next } : {}) },
    openGraph: { type: "website", title, description, url: canonical, siteName },
  };
}

export default async function CategoryArchivePage({
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

  const cat = await db.query.categories.findFirst({ where: eq(categories.slug, slug) });
  if (!cat) notFound();

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

  const postPage = await fetchPostPage({ page, categorySlug: slug });
  const HomeView = getThemeHomeView(activeTheme);

  return (
    <HomeView
      posts={postPage.posts}
      layoutConfig={layoutConfig}
      pagination={{ page: postPage.page, totalPages: postPage.totalPages }}
      heading={cat.name}
      subheading={cat.description ?? `All posts in ${cat.name}`}
    />
  );
}
