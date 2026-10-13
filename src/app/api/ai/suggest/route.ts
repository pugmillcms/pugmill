import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { adminUsers, posts } from "@/lib/db/schema";
import { and, eq, ne, desc } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { withAiRoute } from "@/lib/ai-route";
import { buildSystemPrompt, type SuggestType } from "@/lib/ai-suggest-prompts";

export { buildSystemPrompt };

export async function POST(req: NextRequest) {
  return withAiRoute(req, async ({ ai, usage, userId }) => {
    const bodySchema = z.object({
      type:           z.string(),
      content:        z.string().max(100_000).optional(),
      postTitle:      z.string().max(500).optional(),
      postId:         z.number().int().positive().optional(),
      audience:       z.string().max(500).optional(),
      keywords:       z.string().max(1000).optional(),
      existingTags:   z.array(z.string().max(100)).max(200).optional(),
      platform:       z.string().max(50).optional(),
      aeoMeta:        z.record(z.unknown()).optional(),
      passage:        z.string().max(2000).optional(),
      recommendation: z.string().max(1000).optional(),
    });

    const bodyResult = bodySchema.safeParse(await req.json());
    if (!bodyResult.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const { content, postTitle, type, postId, audience, keywords, existingTags, platform, aeoMeta, passage, recommendation } = bodyResult.data;
    // slug and social-post only need the title/meta; all other types require content
    if (!type || (type !== "slug" && type !== "social-post" && !content)) {
      return NextResponse.json({ error: "content and type are required" }, { status: 400 });
    }

    // ── Site-level generation: fetch context server-side ─────────────────────────
    if (type === "site-summary" || type === "site-faqs") {
      const [siteConfig, recentPosts] = await Promise.all([
        getConfig(),
        db
          .select({ title: posts.title, excerpt: posts.excerpt })
          .from(posts)
          .where(and(eq(posts.published, true), eq(posts.type, "post")))
          .orderBy(desc(posts.createdAt))
          .limit(25),
      ]);

      if (recentPosts.length === 0) {
        return NextResponse.json({ error: "No published posts found — publish some content first so the AI has context." }, { status: 422 });
      }

      const siteName = siteConfig.site?.name ?? "this site";
      const postLines = recentPosts
        .map(p => `- "${p.title}"${p.excerpt ? `: ${p.excerpt.slice(0, 120)}` : ""}`)
        .join("\n");

      const systemPrompt = buildSystemPrompt(type, "");
      const userPrompt = `Site name: "${siteName}"\n\nPublished posts:\n${postLines}`;

      try {
        const result = await ai.complete(systemPrompt, userPrompt);
        return NextResponse.json({ result, usage });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI request failed";
        return NextResponse.json({ error: msg, usage }, { status: 502 });
      }
    }

    // ── Internal links: fetch post index server-side, build prompt, return ──────
    if (type === "internal-links") {
      // Fetch published posts AND pages (title, slug, type, excerpt), excluding the
      // current one. Pages live at /<slug>, posts at /post/<slug>; the server
      // resolves the path so a model-invented prefix can never reach the content.
      const conditions = [eq(posts.published, true)];
      if (postId) conditions.push(ne(posts.id, postId));

      const allPosts = (await db
        .select({ title: posts.title, slug: posts.slug, excerpt: posts.excerpt, type: posts.type })
        .from(posts)
        .where(and(...conditions))
        .limit(120)).filter(p => p.slug !== "home");

      if (allPosts.length === 0) {
        return NextResponse.json({ result: "[]" });
      }

      const postsIndex = allPosts
        .map(p => `- slug: ${p.slug} | title: "${p.title}"${p.excerpt ? ` | ${p.excerpt.slice(0, 120)}` : ""}`)
        .join("\n");

      const systemPrompt = `You are an internal linking expert for a blog. Given a post's content and an index of other published posts on the same site, identify 3–5 natural internal linking opportunities.

For each suggestion, identify:
- Which existing post or page to link to (use its exact slug from the index, with no slashes or path prefix)
- The best anchor text (2–6 words from the post content that naturally describe the linked topic)
- The context sentence where the link fits (quote the exact sentence from the content)

Return ONLY a JSON array:
[
  {
    "slug": "existing-post-slug",
    "title": "Existing Post Title",
    "anchorText": "natural anchor text",
    "context": "The exact sentence from the content where this link fits naturally."
  }
]

No markdown fences. No explanation outside the JSON. Only suggest posts that are genuinely topically relevant. If fewer than 3 good matches exist, return fewer.`;

      const userPrompt = `Post title: "${postTitle ?? ""}"\n\nPost content:\n${content}\n\n---\nPublished posts index:\n${postsIndex}`;

      try {
        const raw = await ai.complete(systemPrompt, userPrompt);
        // Validate against the index: keep only known slugs and attach the real path.
        const bySlug = new Map(allPosts.map(p => [p.slug, p]));
        let result = raw;
        try {
          const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()) as Array<Record<string, unknown>>;
          const cleaned = (Array.isArray(parsed) ? parsed : []).flatMap(sug => {
            const slug = String(sug.slug ?? "").trim().replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+/, "").replace(/^post\//, "").replace(/\/+$/, "");
            const target = bySlug.get(slug);
            if (!target) return [];
            return [{ ...sug, slug, title: target.title, path: target.type === "page" ? `/${slug}` : `/post/${slug}` }];
          });
          result = JSON.stringify(cleaned);
        } catch { /* leave the raw text; the client shows a parse error */ }
        return NextResponse.json({ result, usage });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI request failed";
        return NextResponse.json({ error: msg, usage }, { status: 502 });
      }
    }

    // ── Social post generation ────────────────────────────────────────────────
    if (type === "social-post") {
      const plat = (platform ?? "LinkedIn").trim();

      const platformGuide: Record<string, { prompt: string; limit: number }> = {
        LinkedIn: { limit: 3000, prompt: "Professional tone, insight-forward, 2-4 short paragraphs. No hashtag spam — 2-3 relevant hashtags max at the end." },
        X:        { limit: 280,  prompt: "Punchy and direct. One concise insight or hook — lead with the strongest line. No hashtags unless they add real value." },
        Facebook: { limit: 500,  prompt: "Conversational and approachable. 2-3 short paragraphs with a question or call-to-action at the end." },
        Substack: { limit: 800,  prompt: "Thoughtful and personal, like a note to readers. 2-4 short paragraphs. No hashtags." },
      };
      const platConfig = platformGuide[plat];
      const charLimit = platConfig?.limit ?? 500;
      const platPrompt = platConfig?.prompt ?? "Be engaging and concise.";

      const systemPrompt = `You are a social media copywriter writing a post for ${plat}. ${platPrompt} HARD LIMIT: your response MUST be under ${charLimit} characters total — count carefully before responding. Return ONLY the post text, ready to copy and paste. No commentary, no labels, no markdown formatting.`;

      // Build user prompt — prefer AEO metadata over raw content
      let userPrompt = "";
      if (aeoMeta && typeof aeoMeta === "object") {
        const meta = aeoMeta as { summary?: string; questions?: { q: string; a: string }[]; keywords?: string[] };
        const parts: string[] = [];
        if (postTitle) parts.push(`Post title: "${postTitle}"`);
        if (meta.summary) parts.push(`Summary: ${meta.summary}`);
        if (meta.questions?.length) {
          const topQa = meta.questions.slice(0, 2).map(q => `Q: ${q.q}\nA: ${q.a}`).join("\n");
          parts.push(`Key Q&A:\n${topQa}`);
        }
        if (meta.keywords?.length) parts.push(`Keywords: ${meta.keywords.slice(0, 8).join(", ")}`);
        userPrompt = parts.join("\n\n");
      }
      if (!userPrompt && content) {
        userPrompt = postTitle
          ? `Post title: "${postTitle}"\n\nPost content:\n${content.slice(0, 3000)}`
          : `Post content:\n${content.slice(0, 3000)}`;
      }
      if (!userPrompt) {
        userPrompt = postTitle ? `Post title: "${postTitle}"` : "Write a compelling social post about this content.";
      }

      try {
        const result = await ai.complete(systemPrompt, userPrompt);
        return NextResponse.json({ result, usage });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI request failed";
        return NextResponse.json({ error: msg, usage }, { status: 502 });
      }
    }

    // ── Swap passage: rewrite a specific passage based on a recommendation ───────
    if (type === "swap-passage") {
      if (!passage || !recommendation) {
        return NextResponse.json({ error: "passage and recommendation are required" }, { status: 400 });
      }
      const dbUser2 = await db.query.adminUsers.findFirst({ where: eq(adminUsers.id, userId) });
      const authorVoice2 = dbUser2?.authorVoice ?? "";
      const systemPrompt2 = buildSystemPrompt("swap-passage", authorVoice2);
      const userPrompt2 = `Passage to rewrite:\n"${passage}"\n\nIssue to fix:\n${recommendation}`;
      try {
        const result = await ai.complete(systemPrompt2, userPrompt2);
        return NextResponse.json({ result, usage });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI request failed";
        return NextResponse.json({ error: msg, usage }, { status: 502 });
      }
    }

    const dbUser = await db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, userId),
    });
    const authorVoice = dbUser?.authorVoice ?? "";

    const systemPrompt = buildSystemPrompt(type as SuggestType, authorVoice, { existingTags });
    const userPrompt = type === "slug"
      ? `Post title: "${postTitle ?? ""}"`
      : postTitle
          ? `Post title: "${postTitle}"\n\nPost content:\n${content}`
          : `Post content:\n${content}`;

    try {
      const result = await ai.complete(systemPrompt, userPrompt);
      return NextResponse.json({ result, usage });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI request failed";
      return NextResponse.json({ error: msg, usage }, { status: 502 });
    }
  });
}
