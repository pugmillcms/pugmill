import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAiProvider } from "@/lib/ai";
import { db } from "@/lib/db";
import { adminUsers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { checkAndIncrementAi } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const usage = await checkAndIncrementAi(String(session.user.id));
  if (!usage.allowed) {
    return NextResponse.json(
      { error: "AI rate limit reached. Your limit resets in under 1 hour.", usage },
      { status: 429 },
    );
  }

  const ai = await getAiProvider();
  if (!ai) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }

  const { content, postTitle, mode } = await req.json() as {
    content?: string;
    postTitle?: string;
    mode?: "write" | "refine";
  };
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const dbUser = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.id, String(session.user.id)),
  });
  const authorVoice = dbUser?.authorVoice ?? "";

  const voiceClause = authorVoice
    ? `Author's voice and style guide:\n${authorVoice}`
    : "Maintain a clear, engaging, professional tone.";

  const isWrite = mode === "write";

  const systemPrompt = isWrite
    ? [
        "You are an expert blog writer.",
        voiceClause,
        "The user has provided a prompt, topic, or rough outline. Write a complete, well-structured blog article based on it. Use the post title as additional context if provided. Produce proper Markdown with H2/H3 headings, paragraphs, and where appropriate lists or blockquotes. Return ONLY the body content in Markdown — the post title is managed separately, do not include it as a heading. No commentary, explanations, or metadata.",
      ].join("\n\n")
    : [
        "You are an expert editor. Your job is to refine blog post content while preserving the author's intent and all factual information.",
        voiceClause,
        "Return ONLY the refined body content in Markdown format. The post title is managed separately — do not include it as a heading or in any other form at the start of your response. Do not add commentary, explanations, or metadata.",
      ].join("\n\n");

  const userPrompt = isWrite
    ? postTitle
      ? `Post title: "${postTitle}"\n\nUser prompt:\n${content}`
      : `User prompt:\n${content}`
    : postTitle
      ? `Refine the following content for a post titled "${postTitle}":\n\n${content}`
      : `Refine the following content:\n\n${content}`;

  try {
    const result = await ai.complete(systemPrompt, userPrompt);
    return NextResponse.json({ result, usage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI request failed";
    return NextResponse.json({ error: msg, usage }, { status: 502 });
  }
}
