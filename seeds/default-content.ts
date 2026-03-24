import { db } from "../src/lib/db";
import { posts } from "../src/lib/db/schema";
import { count } from "drizzle-orm";

const ABOUT_PAGE = {
  type: "page" as const,
  slug: "about",
  title: "About Pugmill",
  excerpt: "Pugmill is a modern, developer-friendly CMS built for teams who want full control over their content without sacrificing simplicity.",
  content: `# About Pugmill

Pugmill is a lightweight, open-source content management system built on Next.js, PostgreSQL, and Drizzle ORM. It was designed for developers and small teams who want the flexibility of a modern stack without the overhead of a traditional CMS.

## What Pugmill Is

At its core, Pugmill is a headless-ready CMS that ships with its own front-end theme system. You get a clean admin interface for managing posts, pages, media, and users — plus a plugin architecture that lets you extend functionality without modifying the core.

Key features include:

- **Markdown + visual editing** via a Tiptap-powered editor with raw/visual toggle
- **Pluggable storage** — local filesystem or S3-compatible object storage
- **Theme system** with design token customisation and live preview
- **Scheduled publishing**, featured posts, categories, tags, and hierarchical pages
- **AEO (Answer Engine Optimisation)** metadata for structured Q&A and entity data
- **Role-based access** — admin and editor roles with ownership enforcement
- **RSS feed, sitemap, and llms.txt** routes out of the box

## Who It's For

Pugmill is built for developers setting up content sites for themselves or their clients. It assumes you're comfortable with a terminal and a .env file. Everything else — content, design, plugins — is managed through the admin interface.

## Getting Started

If you're reading this, setup is complete. Log in at [/admin/login](/admin/login), explore the admin panel, and make this site your own. You can edit or delete this page at any time.`,
  published: true,
  publishedAt: new Date(),
};

const HELLO_POST = {
  type: "post" as const,
  slug: "what-is-a-pugmill",
  title: "What Is a Pugmill? (And Why We Named a CMS After One)",
  excerpt: "A pugmill is a machine used in ceramics to reclaim, mix, and condition clay. It turns raw, unworkable material into something ready to shape. We thought that was a pretty good metaphor for a CMS.",
  content: `# What Is a Pugmill?

In ceramics, a **pugmill** is a machine with a single, unglamorous job: it takes raw or reclaimed clay — lumpy, inconsistent, full of air pockets — and works it into a smooth, uniform mass ready for the wheel or the press.

You feed material in one end. Usable clay comes out the other. No fuss.

## The Machine

A pugmill works by forcing clay through a tapered barrel using an auger screw. As the clay moves through, it's compressed, de-aired, and homogenised. Potters use pugmills to reclaim scraps and offcuts that would otherwise go to waste, returning them to workable condition without hours of hand-wedging.

It is not a glamorous tool. It sits in the corner of the studio, covered in dried clay, doing the same thing every day. But without it, nothing else in the studio works as well.

## The Metaphor

Content has the same problem clay does. It arrives from everywhere — writers, editors, clients, imports, APIs — in inconsistent shapes and states. Formatting all over the place. Structure missing. Relationships undefined.

A CMS is supposed to fix that. It takes raw content in and produces something structured, publishable, and consistent on the other side.

Most CMS platforms have drifted a long way from that simple idea. They've accumulated plugins, page builders, subscription tiers, and abstractions until the original job — condition your content, make it ready — is buried under layers of complexity.

Pugmill is an attempt to get back to the simple machine in the corner of the studio.

## What We're Building

Pugmill is a developer-first CMS built on Next.js and PostgreSQL. It ships with the basics done well: posts, pages, media, users, themes, and a clean admin interface. It has a plugin system for the things you might need but don't always. It has no cloud lock-in, no monthly fee, and no page builder.

Feed your content in one end. Get a clean, fast, well-structured site out the other.

*You can edit or delete this post from the admin panel. Welcome to Pugmill.*`,
  published: true,
  publishedAt: new Date(),
};

/**
 * Seed one default post and one default page on fresh installs.
 * No-op if any posts already exist in the database.
 */
export async function seedDefaultContent(adminId: string): Promise<void> {
  const [{ total }] = await db.select({ total: count() }).from(posts);
  if (Number(total) > 0) return;

  await db.insert(posts).values([
    { ...HELLO_POST, authorId: adminId, featured: true } as typeof posts.$inferInsert,
    { ...ABOUT_PAGE, authorId: adminId } as typeof posts.$inferInsert,
  ]);

  console.log("✅ Default content seeded (post + about page).");
}
