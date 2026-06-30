import { db } from "@/lib/db";
import { posts, postCategories, postTags, categories, tags } from "@/lib/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { sanitizeThemeName } from "@/lib/theme-registry";
import { getDesignConfig } from "@/lib/design-config";
import { getThemePageView, getThemeSections } from "@/lib/theme-modules";
import { hooks } from "@/lib/hooks";
import type { PostPayload } from "@/lib/hook-catalogue";
import type { ArticleLayoutConfig } from "../../../themes/default/design";
import type { Breadcrumb } from "../../../themes/default/views/PageView";
import WidgetArea from "@/components/widgets/WidgetArea";
import { getWidgetAreaAssignment } from "@/lib/actions/widgets";
import type { WidgetContext } from "@/types/widget";
import { getActiveSlots } from "@/lib/plugin-registry";
import type { Config } from "@/lib/config";
import type { HomepageSection } from "@/types/homepage-sections";

type PageRow = typeof posts.$inferSelect;

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

// ─── Shared page renderer ───────────────────────────────────────────────────────
//
// Renders an already-fetched published page (a posts row with type="page")
// through the active theme's PageView, including breadcrumbs, sidebar/footer
// widgets, plugin slots, and the featured image. Shared by the /[slug] route and
// the static-front-page homepage so both render pages identically.

export async function RenderedPage({
  page,
  config,
  isPreview,
}: {
  page: PageRow;
  config: Config;
  isPreview: boolean;
}) {
  const activeTheme = sanitizeThemeName(config.appearance.activeTheme);

  // Section-composed page: render the theme's section stack (like the homepage)
  // instead of the single-body PageView. null/empty sections fall through to
  // the Markdown body below (the default, backward-compatible path).
  const sectionStack = Array.isArray(page.sections) ? (page.sections as HomepageSection[]) : null;
  if (sectionStack && sectionStack.length > 0) {
    const ThemeSections = getThemeSections(activeTheme);
    return <ThemeSections sections={sectionStack} page={1} />;
  }

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

  const [filteredContent, breadcrumbs, pageCategories, pageTags] = await Promise.all([
    hooks.applyFilters("content:render", { input: page.content, post: postPayload }),
    resolveBreadcrumbs(page.parentId),
    db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(postCategories)
      .innerJoin(categories, eq(categories.id, postCategories.categoryId))
      .where(eq(postCategories.postId, page.id)),
    db
      .select({ id: tags.id, name: tags.name, slug: tags.slug })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(eq(postTags.postId, page.id)),
  ]);

  // Sibling pages for sidebar navigation (only relevant when there is a parent)
  let siblingPages: { title: string; slug: string }[] = [];
  if (layoutConfig.sidebar !== "none" && page.parentId !== null) {
    siblingPages = await db
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
  }

  const widgetCtx: WidgetContext = {
    type: "page",
    postId: page.id,
    slug: page.slug,
    content: page.content,
    categoryIds: pageCategories.map(c => c.id),
    tagIds: pageTags.map(t => t.id),
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

  let pageFooterWidgets: React.ReactNode = undefined;
  const pageFooterIds = await getWidgetAreaAssignment("page-footer");
  if (pageFooterIds.length > 0) {
    pageFooterWidgets = await WidgetArea({ widgetIds: pageFooterIds, context: widgetCtx }) ?? undefined;
  }

  // Fetch featured image for the page (uses page.featuredImage column).
  const pageFeaturedMedia = page.featuredImage
    ? await db.query.media.findFirst({ where: (m, { eq }) => eq(m.id, page.featuredImage!) })
    : null;
  const pageFeaturedUrl = pageFeaturedMedia?.url ?? null;
  const pageFeaturedAlt = pageFeaturedMedia?.altText ?? null;

  const PageView = getThemePageView(activeTheme);
  const slotProps = { postId: page.id, postSlug: page.slug, postType: "page" as const };
  const articleHeaderSlots = getActiveSlots("articleHeader", config.modules.activePlugins, config.modules.pluginSettings);
  const articleFooterSlots = getActiveSlots("articleFooter", config.modules.activePlugins, config.modules.pluginSettings);
  const postFooterSlots    = getActiveSlots("postFooter",    config.modules.activePlugins, config.modules.pluginSettings);

  return (
    <>
      <PageView
        title={page.title}
        content={filteredContent}
        breadcrumbs={breadcrumbs}
        layoutConfig={layoutConfig}
        siblingPages={siblingPages}
        sidebarContent={sidebarContent}
        categories={pageCategories}
        tags={pageTags}
        publishedAt={page.publishedAt}
        featuredImageUrl={pageFeaturedUrl}
        featuredImageAlt={pageFeaturedAlt}
        articleHeaderContent={articleHeaderSlots.map(({ pluginId, Component }) => (
          <Component key={pluginId} {...slotProps} />
        ))}
        articleFooterContent={articleFooterSlots.map(({ pluginId, Component }) => (
          <Component key={pluginId} {...slotProps} />
        ))}
        footerWidgets={pageFooterWidgets}
      />
      {postFooterSlots.map(({ pluginId, Component }) => (
        <Component key={pluginId} {...slotProps} />
      ))}
    </>
  );
}
