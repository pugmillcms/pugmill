/**
 * MCP tool definitions and handlers.
 *
 * All tools operate directly on the Pugmill CMS database via Drizzle ORM.
 * Each tool returns an McpToolResult — either toolSuccess(json) or toolError(msg).
 */

import { db } from "../../src/lib/db";
import { posts, media, adminUsers } from "../../src/lib/db/schema";
import { eq, ilike, or, desc, and, sql, asc } from "drizzle-orm";
import { getConfig } from "../../src/lib/config";
import type { McpToolDefinition, McpToolResult } from "./protocol";
import { toolSuccess, toolError } from "./protocol";

// ─── Slug helper ──────────────────────────────────────────────────────────────

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Tool type ────────────────────────────────────────────────────────────────

export interface McpTool {
  definition: McpToolDefinition;
  handler: (params: unknown) => Promise<McpToolResult>;
  /** True for content-mutating tools — requires an API key with "readwrite" scope. */
  write?: boolean;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const listPostsTool: McpTool = {
  definition: {
    name: "list_posts",
    description: "List posts from the CMS. Returns id, title, slug, status, excerpt, and publishedAt for each post.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["published", "draft", "all"],
          description: "Filter by status. Defaults to 'published'.",
        },
        limit: {
          type: "number",
          description: "Maximum number of posts to return (default 20, max 100).",
        },
        offset: {
          type: "number",
          description: "Number of posts to skip for pagination (default 0).",
        },
      },
    },
  },

  async handler(params) {
    const p = (params ?? {}) as Record<string, unknown>;
    const status = typeof p.status === "string" ? p.status : "published";
    const limit = Math.min(100, Math.max(1, typeof p.limit === "number" ? p.limit : 20));
    const offset = typeof p.offset === "number" ? Math.max(0, p.offset) : 0;

    try {
      const conditions = [];
      if (status === "published") conditions.push(eq(posts.published, true));
      if (status === "draft")     conditions.push(eq(posts.published, false));
      // "all" — no filter

      const rows = await db
        .select({
          id: posts.id,
          title: posts.title,
          slug: posts.slug,
          published: posts.published,
          excerpt: posts.excerpt,
          publishedAt: posts.publishedAt,
          type: posts.type,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(posts.createdAt))
        .limit(limit)
        .offset(offset);

      const result = rows.map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        status: r.published ? "published" : "draft",
        type: r.type,
        excerpt: r.excerpt ?? null,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));

      return toolSuccess(JSON.stringify(result, null, 2));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Failed to list posts");
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const getPostTool: McpTool = {
  definition: {
    name: "get_post",
    description: "Get a full post by its slug, including content, AEO metadata, categories, and tags.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "The post slug.",
        },
      },
      required: ["slug"],
    },
  },

  async handler(params) {
    const p = (params ?? {}) as Record<string, unknown>;
    const slug = typeof p.slug === "string" ? p.slug.trim() : "";

    if (!slug) return toolError("slug is required");

    try {
      const row = await db.query.posts.findFirst({
        where: eq(posts.slug, slug),
        with: {
          postCategories: { with: { category: true } },
          postTags:       { with: { tag: true } },
        },
      });

      if (!row) return toolError(`No post found with slug "${slug}"`);

      const result = {
        id: row.id,
        title: row.title,
        slug: row.slug,
        type: row.type,
        status: row.published ? "published" : "draft",
        content: row.content,
        excerpt: row.excerpt ?? null,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        aeoMetadata: row.aeoMetadata ?? null,
        categories: (row.postCategories ?? []).map((pc: { category: { name: string; slug: string } }) => ({
          name: pc.category.name,
          slug: pc.category.slug,
        })),
        tags: (row.postTags ?? []).map((pt: { tag: { name: string; slug: string } }) => ({
          name: pt.tag.name,
          slug: pt.tag.slug,
        })),
      };

      return toolSuccess(JSON.stringify(result, null, 2));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Failed to get post");
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const createPostTool: McpTool = {
  write: true,
  definition: {
    name: "create_post",
    description: "Create a new draft post. Returns the new post id and slug.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Post title (required).",
        },
        content: {
          type: "string",
          description: "Post body content (Markdown or HTML).",
        },
        excerpt: {
          type: "string",
          description: "Short excerpt or summary.",
        },
        type: {
          type: "string",
          enum: ["post", "page"],
          description: "Content type — 'post' (default) or 'page'.",
        },
      },
      required: ["title"],
    },
  },

  async handler(params) {
    const p = (params ?? {}) as Record<string, unknown>;
    const title = typeof p.title === "string" ? p.title.trim() : "";
    if (!title) return toolError("title is required");

    const content = typeof p.content === "string" ? p.content : "";
    const excerpt = typeof p.excerpt === "string" ? p.excerpt.trim() || null : null;
    const type    = p.type === "page" ? "page" : "post";

    // Generate a unique slug
    const baseSlug = slugify(title) || "post";
    let slug = baseSlug;

    try {
      // Check for slug collisions and append a suffix if needed
      const existing = await db
        .select({ slug: posts.slug })
        .from(posts)
        .where(sql`slug LIKE ${baseSlug + "%"}`);

      const existingSlugs = new Set(existing.map((r) => r.slug));
      if (existingSlugs.has(slug)) {
        let n = 2;
        while (existingSlugs.has(`${baseSlug}-${n}`)) n++;
        slug = `${baseSlug}-${n}`;
      }

      const [inserted] = await db
        .insert(posts)
        .values({
          title,
          slug,
          content,
          excerpt,
          type,
          published: false,
          featured: false,
          robotsNoindex: false,
          robotsNofollow: false,
        } as typeof posts.$inferInsert)
        .returning({ id: posts.id, slug: posts.slug });

      return toolSuccess(JSON.stringify({ id: inserted.id, slug: inserted.slug }, null, 2));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Failed to create post");
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const updatePostTool: McpTool = {
  write: true,
  definition: {
    name: "update_post",
    description: "Update an existing post by slug. Only provided fields are updated.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Slug of the post to update.",
        },
        title: {
          type: "string",
          description: "New title.",
        },
        content: {
          type: "string",
          description: "New body content.",
        },
        excerpt: {
          type: "string",
          description: "New excerpt.",
        },
      },
      required: ["slug"],
    },
  },

  async handler(params) {
    const p = (params ?? {}) as Record<string, unknown>;
    const slug = typeof p.slug === "string" ? p.slug.trim() : "";
    if (!slug) return toolError("slug is required");

    const updates: Partial<typeof posts.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (typeof p.title   === "string") updates.title   = p.title;
    if (typeof p.content === "string") updates.content = p.content;
    if (typeof p.excerpt === "string") updates.excerpt = p.excerpt || null;

    try {
      const [updated] = await db
        .update(posts)
        .set(updates)
        .where(eq(posts.slug, slug))
        .returning({ id: posts.id, slug: posts.slug, title: posts.title });

      if (!updated) return toolError(`No post found with slug "${slug}"`);

      return toolSuccess(JSON.stringify({
        id: updated.id,
        slug: updated.slug,
        title: updated.title,
        updated: true,
      }, null, 2));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Failed to update post");
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const publishPostTool: McpTool = {
  write: true,
  definition: {
    name: "publish_post",
    description: "Publish a draft post by slug. Sets status to published and records publishedAt if not already set.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Slug of the post to publish.",
        },
      },
      required: ["slug"],
    },
  },

  async handler(params) {
    const p = (params ?? {}) as Record<string, unknown>;
    const slug = typeof p.slug === "string" ? p.slug.trim() : "";
    if (!slug) return toolError("slug is required");

    try {
      // Fetch current row to check if publishedAt is already set
      const row = await db.query.posts.findFirst({ where: eq(posts.slug, slug) });
      if (!row) return toolError(`No post found with slug "${slug}"`);

      const now = new Date();
      const [updated] = await db
        .update(posts)
        .set({
          published: true,
          publishedAt: row.publishedAt ?? now,
          updatedAt: now,
        })
        .where(eq(posts.slug, slug))
        .returning({ id: posts.id, slug: posts.slug, publishedAt: posts.publishedAt });

      return toolSuccess(JSON.stringify({
        id: updated.id,
        slug: updated.slug,
        status: "published",
        publishedAt: updated.publishedAt?.toISOString() ?? null,
      }, null, 2));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Failed to publish post");
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const unpublishPostTool: McpTool = {
  write: true,
  definition: {
    name: "unpublish_post",
    description: "Revert a published post back to draft status.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "Slug of the post to unpublish.",
        },
      },
      required: ["slug"],
    },
  },

  async handler(params) {
    const p = (params ?? {}) as Record<string, unknown>;
    const slug = typeof p.slug === "string" ? p.slug.trim() : "";
    if (!slug) return toolError("slug is required");

    try {
      const [updated] = await db
        .update(posts)
        .set({ published: false, updatedAt: new Date() })
        .where(eq(posts.slug, slug))
        .returning({ id: posts.id, slug: posts.slug });

      if (!updated) return toolError(`No post found with slug "${slug}"`);

      return toolSuccess(JSON.stringify({
        id: updated.id,
        slug: updated.slug,
        status: "draft",
      }, null, 2));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Failed to unpublish post");
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const listMediaTool: McpTool = {
  definition: {
    name: "list_media",
    description: "List media files uploaded to the CMS.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of files to return (default 20).",
        },
      },
    },
  },

  async handler(params) {
    const p = (params ?? {}) as Record<string, unknown>;
    const limit = Math.min(100, Math.max(1, typeof p.limit === "number" ? p.limit : 20));

    try {
      const rows = await db
        .select({
          id: media.id,
          fileName: media.fileName,
          url: media.url,
          fileType: media.fileType,
          fileSize: media.fileSize,
          createdAt: media.createdAt,
        })
        .from(media)
        .orderBy(desc(media.createdAt))
        .limit(limit);

      const result = rows.map((r) => ({
        id: r.id,
        filename: r.fileName,
        url: r.url,
        mimeType: r.fileType ?? null,
        size: r.fileSize ?? null,
        createdAt: r.createdAt.toISOString(),
      }));

      return toolSuccess(JSON.stringify(result, null, 2));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Failed to list media");
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const getSiteContextTool: McpTool = {
  definition: {
    name: "get_site_context",
    description:
      "Return ambient site context an agent should load at the start of a session: site name, URL, description, tagline, and the primary author's voice/style guide. Use this to calibrate tone and style before writing or editing content.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  async handler(_params) {
    try {
      const [config, primaryAuthor] = await Promise.all([
        getConfig(),
        db
          .select({ name: adminUsers.name, authorVoice: adminUsers.authorVoice })
          .from(adminUsers)
          .orderBy(asc(adminUsers.createdAt))
          .limit(1)
          .then(rows => rows[0] ?? null),
      ]);

      const result = {
        site: {
          name:        config.site.name,
          url:         config.site.url,
          description: config.site.description,
          tagline:     (config.site as Record<string, unknown>).tagline ?? null,
        },
        author: {
          name:        primaryAuthor?.name ?? null,
          voice:       primaryAuthor?.authorVoice ?? null,
        },
      };

      return toolSuccess(JSON.stringify(result, null, 2));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Failed to get site context");
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────

const searchPostsTool: McpTool = {
  definition: {
    name: "search_posts",
    description: "Full-text search across post titles and content. Returns same shape as list_posts.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search string to match against post title and content.",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default 10).",
        },
      },
      required: ["query"],
    },
  },

  async handler(params) {
    const p = (params ?? {}) as Record<string, unknown>;
    const query = typeof p.query === "string" ? p.query.trim() : "";
    if (!query) return toolError("query is required");

    const limit = Math.min(100, Math.max(1, typeof p.limit === "number" ? p.limit : 10));
    const pattern = `%${query}%`;

    try {
      const rows = await db
        .select({
          id: posts.id,
          title: posts.title,
          slug: posts.slug,
          published: posts.published,
          excerpt: posts.excerpt,
          publishedAt: posts.publishedAt,
          type: posts.type,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .where(or(ilike(posts.title, pattern), ilike(posts.content, pattern)))
        .orderBy(desc(posts.createdAt))
        .limit(limit);

      const result = rows.map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        status: r.published ? "published" : "draft",
        type: r.type,
        excerpt: r.excerpt ?? null,
        publishedAt: r.publishedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));

      return toolSuccess(JSON.stringify(result, null, 2));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : "Failed to search posts");
    }
  },
};

// ─── Tool registry ────────────────────────────────────────────────────────────

export const ALL_TOOLS: McpTool[] = [
  listPostsTool,
  getPostTool,
  createPostTool,
  updatePostTool,
  publishPostTool,
  unpublishPostTool,
  listMediaTool,
  getSiteContextTool,
  searchPostsTool,
];

export const TOOL_MAP: Map<string, McpTool> = new Map(
  ALL_TOOLS.map((t) => [t.definition.name, t])
);
