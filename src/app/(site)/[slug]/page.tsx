import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getConfig } from "@/lib/config";
import { sanitizeThemeName } from "@/lib/theme-registry";
import { getDesignConfig } from "@/lib/design-config";
import { getThemePageView } from "@/lib/theme-modules";
import { cookies } from "next/headers";
import { hooks } from "@/lib/hooks";
import type { PostPayload } from "@/lib/hook-catalogue";
import type { ArticleLayoutConfig } from "../../../../themes/default/design";
import type { Metadata } from "next";
import WidgetArea from "@/components/widgets/WidgetArea";
import { getWidgetAreaAssignment } from "@/lib/actions/widgets";
import type { WidgetContext } from "@/types/widget";
import type { Breadcrumb } from "../../../../themes/default/views/PageView";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Walk the parentId chain to build breadcrumbs from root → immediate parent. */
async function resolveBreadcrumbs(parentId: number | null): Promise<Breadcrumb[]> {
  const crumbs: Breadcrumb[] = [];
  let id = parentId;
  while (id !== null) {
    const ancestor = await db.query.posts.findFirst({ where: eq(posts.id, id) });
    if (!ancestor) break;
    crumbs.unshift({ title: ancestor.title, slug: ancestor.slug });
    id = ancestor.parentId;
  }
  return crumbs;
}

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
  if (!page) return { title: `Not found | ${siteName}` };

  return {
    title: `${page.title} | ${siteName}`,
    description: page.excerpt ?? config.site.seoDefaults?.metaDescription ?? undefined,
    openGraph: {
      title: page.title,
      description: page.excerpt ?? config.site.seoDefaults?.metaDescription ?? undefined,
      ...(config.site.seoDefaults?.ogImage ? { images: [config.site.seoDefaults.ogImage] } : {}),
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
  const activeTheme = sanitizeThemeName(config.appearance.activeTheme);
  const isPreview = cookieStore.get("__pugmill_design_preview")?.value === "1";
  const designConfig = await getDesignConfig(activeTheme, isPreview ? "draft" : "published");

  const layoutConfig: ArticleLayoutConfig = {
    contentWidth: (designConfig.pageContentWidth as "narrow" | "medium" | "wide") ?? "narrow",
    sidebar: (designConfig.pageSidebar as "none" | "left" | "right") ?? "none",
  };

  const postPayload: PostPayload = {
    id: page.id,
    slug: page.slug,
    title: page.title,
    type: "page",
    published: page.published,
    authorId: page.authorId,
    parentId: page.parentId,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };

  const [filteredContent, breadcrumbs] = await Promise.all([
    hooks.applyFilters("content:render", { input: page.content, post: postPayload }),
    resolveBreadcrumbs(page.parentId),
  ]);

  // Sibling pages for sidebar navigation (only relevant when there is a parent)
  let siblingPages: { title: string; slug: string }[] = [];
  if (layoutConfig.sidebar !== "none" && page.parentId !== null) {
    const siblings = await db
      .select({ title: posts.title, slug: posts.slug })
      .from(posts)
      .where(
        and(
          eq(posts.parentId, page.parentId),
          eq(posts.type, "page"),
          eq(posts.published, true),
          ne(posts.id, page.id),
        )
      );
    siblingPages = siblings;
  }

  const widgetCtx: WidgetContext = {
    type: "page",
    postId: page.id,
    slug: page.slug,
    content: page.content,
    categoryIds: [],
    tagIds: [],
    parentId: page.parentId,
    designConfig,
  };

  let sidebarContent: React.ReactNode = undefined;
  if (layoutConfig.sidebar !== "none") {
    const ids = await getWidgetAreaAssignment("sidebar-page");
    if (ids.length > 0) {
      sidebarContent = await WidgetArea({ widgetIds: ids, context: widgetCtx }) ?? undefined;
    }
  }

  const PageView = getThemePageView(activeTheme);

  return (
    <PageView
      title={page.title}
      content={filteredContent}
      breadcrumbs={breadcrumbs}
      layoutConfig={layoutConfig}
      siblingPages={siblingPages}
      sidebarContent={sidebarContent}
    />
  );
}
