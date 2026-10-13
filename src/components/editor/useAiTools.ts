"use client";
import { useState } from "react";
import type { RefObject } from "react";
import type { MarkdownEditorHandle } from "@/components/editor/MarkdownEditor";
import type { AeoMetadataEditorHandle, AeoMetadata } from "@/components/editor/AeoMetadataEditor";

// ── Shared utility ────────────────────────────────────────────────────────────

export function parseJson<T>(raw: string): T {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(stripped) as T;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const AGENT_STEPS: { tool: string; label: string }[] = [
  { tool: "excerpt",        label: "Excerpt" },
  { tool: "slug",           label: "Slug" },
  { tool: "seo",            label: "SEO Title & Meta" },
  { tool: "aeo",            label: "AEO Metadata" },
  { tool: "keywords",       label: "Keywords" },
  { tool: "categories",     label: "Categories" },
  { tool: "tags",           label: "Tags" },
  { tool: "topic-report",   label: "Topic Focus Report" },
  { tool: "internal-links", label: "Internal Links" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Tag { id: number; name: string; slug: string; }

interface UseAiToolsParams {
  title: string;
  postId?: number;
  allTags: Tag[];
  aeoMeta: AeoMetadata;
  slugManuallySet: boolean;
  setTitle: (t: string) => void;
  setSlug: (s: string) => void;
  setSlugManuallySet: (v: boolean) => void;
  setExcerpt: (e: string) => void;
  setSeoTitle: (t: string) => void;
  setSeoMetaDescription: (d: string) => void;
  setIsDirty: (v: boolean) => void;
  editorRef: RefObject<MarkdownEditorHandle | null>;
  aeoRef: RefObject<AeoMetadataEditorHandle | null>;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAiTools({
  title,
  postId,
  allTags,
  aeoMeta,
  slugManuallySet,
  setTitle,
  setSlug,
  setSlugManuallySet,
  setExcerpt,
  setSeoTitle,
  setSeoMetaDescription,
  setIsDirty,
  editorRef,
  aeoRef,
}: UseAiToolsParams) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiUsage, setAiUsage] = useState<{ count: number; limit: number }>({ count: 0, limit: 50 });
  const [titleSuggestions, setTitleSuggestions] = useState<{ curiosity: string; utility: string } | null>(null);
  const [excerptSuggestion, setExcerptSuggestion] = useState<string | null>(null);
  const [swapPassageState, setSwapPassageState] = useState<{ issueIndex: number; pending: boolean; result: string | null } | null>(null);
  const [refineResult, setRefineResult] = useState<string | null>(null);
  const [refineFocusResult, setRefineFocusResult] = useState<Array<{ label: string; passage?: string; recommendation: string }> | null>(null);
  const [readingLevel, setReadingLevel] = useState<{ level: string; gradeLevel: number; note: string; fit?: string } | null>(null);
  const [dismissedIssues, setDismissedIssues] = useState<Set<number>>(new Set());
  const [toneItems, setToneItems] = useState<Array<{ quote: string; issue: string; suggestion: string }> | null>(null);
  const [catSuggestions, setCatSuggestions] = useState<string[] | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<string[] | null>(null);
  const [moreAiPending, setMoreAiPending] = useState<string | null>(null);
  const [moreAiResults, setMoreAiResults] = useState<Record<string, string>>({});
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentCurrentStep, setAgentCurrentStep] = useState<string | null>(null);
  const [agentSummary, setAgentSummary] = useState<{ step: string; applied: boolean; detail: string }[] | null>(null);
  const [assistFeedback, setAssistFeedback] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const [socialPlatform, setSocialPlatform] = useState<string | null>(null);
  const [socialDraft, setSocialDraft] = useState<string>("");
  const [socialPending, setSocialPending] = useState(false);

  async function callAi(type: string, extra?: Record<string, unknown>): Promise<string | null> {
    setAiError(null);
    const content = editorRef.current?.getContent() ?? "";
    const endpoint = "/api/ai/suggest";
    const body = { content, postTitle: title, type, postId, ...extra };
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { result?: string; error?: string; usage?: { count: number; limit: number } };
      if (data.usage) setAiUsage(data.usage);
      if (!res.ok) {
        if (res.status === 429) setAiError(data.error ?? "AI rate limit reached. Try again in under an hour.");
        else setAiError(data.error ?? "AI request failed");
        return null;
      }
      return data.result ?? null;
    } catch {
      setAiError("Network error — please try again.");
      return null;
    }
  }

  async function handleSuggestTitles() {
    setPendingAction("titles");
    const result = await callAi("titles");
    setPendingAction(null);
    if (!result) return;
    try { setTitleSuggestions(parseJson<{ curiosity: string; utility: string }>(result)); }
    catch { setAiError("Could not parse AI response. Try again."); }
  }

  async function handleGenerateSlug() {
    setPendingAction("slug");
    const result = await callAi("slug");
    setPendingAction(null);
    if (result) { setSlug(result.trim()); setSlugManuallySet(true); }
  }

  async function handleSuggestExcerpt() {
    setPendingAction("excerpt");
    const result = await callAi("excerpt");
    setPendingAction(null);
    if (result) setExcerptSuggestion(result.trim());
  }

  async function handleSwapPassage(issue: { passage?: string; recommendation: string }, index: number) {
    if (!issue.passage) return;
    setSwapPassageState({ issueIndex: index, pending: true, result: null });
    const result = await callAi("swap-passage", { passage: issue.passage, recommendation: issue.recommendation });
    setSwapPassageState({ issueIndex: index, pending: false, result: result ?? null });
  }

  function applySwapPassage(original: string, rewritten: string) {
    const content = editorRef.current?.getContent() ?? "";
    if (content.includes(original)) {
      editorRef.current?.setContent(content.replace(original, rewritten));
    }
    setSwapPassageState(null);
  }

  async function handleSuggestSeo() {
    setPendingAction("seo");
    const result = await callAi("seo");
    setPendingAction(null);
    if (!result) return;
    try {
      const parsed = parseJson<{ seoTitle?: string; seoMetaDescription?: string }>(result);
      if (parsed.seoTitle) setSeoTitle(parsed.seoTitle.slice(0, 60));
      if (parsed.seoMetaDescription) setSeoMetaDescription(parsed.seoMetaDescription.slice(0, 155));
      setIsDirty(true);
    } catch { setAiError("Could not parse AI response. Try again."); }
  }

  async function handleRewrite(instructions?: string) {
    setPendingAction("rewrite");
    const content = editorRef.current?.getContent() ?? "";
    setAiError(null);
    try {
      const res = await fetch("/api/ai/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, postTitle: title, instructions }),
      });
      const data = (await res.json()) as { result?: string; error?: string };
      if (!res.ok) { setAiError(data.error ?? "AI request failed"); }
      else if (data.result) { setRefineResult(data.result); }
    } catch { setAiError("Network error — please try again."); }
    setPendingAction(null);
  }

  async function handleReadingLevel() {
    setReadingLevel(null);
    setPendingAction("reading-level");
    const result = await callAi("reading-level");
    setPendingAction(null);
    if (!result) return;
    try {
      setReadingLevel(parseJson<{ level: string; gradeLevel: number; note: string; fit?: string }>(result));
    } catch { setAiError("Could not parse AI response. Try again."); }
  }

  async function handleAssist(instruction: string) {
    if (!instruction.trim()) return;
    setAssistFeedback(null);
    setAiError(null);
    setPendingAction("assist");

    let action = "unknown";
    let instructions: string | null = null;

    try {
      const res = await fetch("/api/ai/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction }),
      });
      const data = (await res.json()) as { action?: string; instructions?: string | null; usage?: { count: number; limit: number } };
      if (data.usage) setAiUsage(data.usage);
      action = data.action ?? "unknown";
      instructions = data.instructions ?? null;
    } catch {
      setAiError("Network error — please try again.");
      setPendingAction(null);
      return;
    }

    setPendingAction(null);

    switch (action) {
      case "rewrite":        await handleRewrite(instructions ?? instruction); break;
      case "excerpt":        await handleSuggestExcerpt(); break;
      case "slug":           await handleGenerateSlug(); break;
      case "seo":            await handleSuggestSeo(); break;
      case "aeo":            await handleDraftAeo(); break;
      case "categories":     await handleSuggestCategories(); break;
      case "tags":           await handleSuggestTags(); break;
      case "tone-check":     await handleToneCheck(); break;
      case "reading-level":  await handleReadingLevel(); break;
      case "topic-report":   await runMoreAi("topic-report"); break;
      case "internal-links": await runMoreAi("internal-links"); break;
      default:
        setAssistFeedback("I can help with rewriting, excerpts, slugs, SEO, AEO metadata, categories, tags, tone checks, reading level, topic focus, and internal links. Try: \"simplify this\", \"suggest an excerpt\", or \"check the tone\".");
    }
  }

  async function handleToneCheck() {
    setPendingAction("tone-check");
    const result = await callAi("tone-check");
    setPendingAction(null);
    if (!result) return;
    try { setToneItems(parseJson<Array<{ quote: string; issue: string; suggestion: string }>>(result)); }
    catch { setAiError("Could not parse AI response. Try again."); }
  }

  async function handleRefineFocus() {
    setRefineFocusResult(null);
    setDismissedIssues(new Set());
    setPendingAction("refine-focus");
    const result = await callAi("refine-focus");
    setPendingAction(null);
    if (!result) return;
    try {
      setRefineFocusResult(parseJson<Array<{ label: string; passage?: string; recommendation: string }>>(result));
    } catch { setAiError("Could not parse AI response. Try again."); }
  }

  async function handleSocialPost(platform: string) {
    setSocialPlatform(platform);
    setSocialDraft("");
    setSocialPending(true);
    setAiError(null);
    const content = editorRef.current?.getContent() ?? "";
    try {
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "social-post", platform, postTitle: title, content, aeoMeta }),
      });
      const data = (await res.json()) as { result?: string; error?: string; usage?: { count: number; limit: number } };
      if (data.usage) setAiUsage(data.usage);
      if (!res.ok) {
        if (res.status === 429) setAiError(data.error ?? "AI rate limit reached.");
        else setAiError(data.error ?? "AI request failed");
      } else if (data.result) {
        setSocialDraft(data.result);
      }
    } catch {
      setAiError("Network error — please try again.");
    }
    setSocialPending(false);
  }

  async function handleSuggestCategories() {
    setPendingAction("categories");
    const result = await callAi("categories");
    setPendingAction(null);
    if (!result) return;
    try { setCatSuggestions(parseJson<string[]>(result)); }
    catch { setAiError("Could not parse AI response. Try again."); }
  }

  async function handleSuggestTags() {
    setPendingAction("tags");
    const result = await callAi("tags", { existingTags: allTags.map(t => t.name) });
    setPendingAction(null);
    if (!result) return;
    try { setTagSuggestions(parseJson<string[]>(result)); }
    catch { setAiError("Could not parse AI response. Try again."); }
  }

  async function handleGenerateAll() {
    setAgentRunning(true);
    setPendingAction("generate-all");
    setAgentCurrentStep(null);
    setAgentSummary(null);
    setMoreAiResults({});
    const summary: { step: string; applied: boolean; detail: string }[] = [];
    let lastAeo: AeoMetadata | null = null;

    for (const { tool, label } of AGENT_STEPS) {
      if (tool === "slug" && slugManuallySet) {
        summary.push({ step: label, applied: false, detail: "Skipped — slug manually set" });
        continue;
      }
      setAgentCurrentStep(label);
      const extra = tool === "tags" ? { existingTags: allTags.map(t => t.name) } : undefined;
      try {
        const result = await callAi(tool, extra);
        if (!result) { summary.push({ step: label, applied: false, detail: "No result" }); continue; }

        if (tool === "excerpt") {
          setExcerpt(result.trim());
          const preview = result.trim().slice(0, 80);
          summary.push({ step: label, applied: true, detail: preview + (result.trim().length > 80 ? "…" : "") });
        } else if (tool === "slug") {
          setSlug(result.trim());
          setSlugManuallySet(true);
          summary.push({ step: label, applied: true, detail: result.trim() });
        } else if (tool === "seo") {
          try {
            const p = parseJson<{ seoTitle?: string; seoMetaDescription?: string }>(result);
            if (p.seoTitle) setSeoTitle(p.seoTitle.slice(0, 60));
            if (p.seoMetaDescription) setSeoMetaDescription(p.seoMetaDescription.slice(0, 155));
            summary.push({ step: label, applied: true, detail: p.seoTitle ?? "Applied" });
          } catch { summary.push({ step: label, applied: false, detail: "Parse error" }); }
        } else if (tool === "aeo") {
          try {
            const p = parseJson<AeoMetadata>(result);
            lastAeo = p;
            aeoRef.current?.setValue(p);
            const preview = p.summary?.slice(0, 80) ?? "Applied";
            summary.push({ step: label, applied: true, detail: preview + ((p.summary?.length ?? 0) > 80 ? "…" : "") });
          } catch { summary.push({ step: label, applied: false, detail: "Parse error" }); }
        } else if (tool === "keywords") {
          try {
            const kws = parseJson<string[]>(result);
            const merged = { ...(lastAeo ?? aeoMeta), keywords: kws };
            aeoRef.current?.setValue(merged);
            lastAeo = merged;
            summary.push({ step: label, applied: true, detail: `${kws.length} keyword${kws.length !== 1 ? "s" : ""} added` });
          } catch { summary.push({ step: label, applied: false, detail: "Parse error" }); }
        } else if (tool === "categories") {
          try {
            const cats = parseJson<string[]>(result);
            setCatSuggestions(cats);
            summary.push({ step: label, applied: false, detail: `${cats.length} suggestion${cats.length !== 1 ? "s" : ""} ready to review` });
          } catch { summary.push({ step: label, applied: false, detail: "Parse error" }); }
        } else if (tool === "tags") {
          try {
            const tags = parseJson<string[]>(result);
            setTagSuggestions(tags);
            summary.push({ step: label, applied: false, detail: `${tags.length} suggestion${tags.length !== 1 ? "s" : ""} ready to review` });
          } catch { summary.push({ step: label, applied: false, detail: "Parse error" }); }
        } else {
          setMoreAiResults(prev => ({ ...prev, [tool]: result }));
          summary.push({ step: label, applied: false, detail: "Result available below" });
        }
      } catch {
        summary.push({ step: label, applied: false, detail: "Error — skipped" });
      }
    }

    setAgentCurrentStep(null);
    setAgentSummary(summary);
    setAgentRunning(false);
    setPendingAction(null);
    setIsDirty(true);
  }

  async function handleDraftAeo() {
    setPendingAction("aeo");
    // Run sequentially to avoid parallel request interference / parse errors.
    const aeoResult = await callAi("aeo");
    if (!aeoResult) { setPendingAction(null); return; }
    let parsed: AeoMetadata;
    try {
      parsed = parseJson<AeoMetadata>(aeoResult);
    } catch {
      setAiError("Could not parse AI response. Try again.");
      setPendingAction(null);
      return;
    }
    const kwResult = await callAi("keywords");
    if (kwResult) {
      try { parsed.keywords = parseJson<string[]>(kwResult); } catch { /* keep existing */ }
    }
    aeoRef.current?.setValue(parsed);
    setPendingAction(null);
  }

  async function runMoreAi(type: string) {
    setMoreAiPending(type);
    const result = await callAi(type);
    setMoreAiPending(null);
    if (result) setMoreAiResults(prev => ({ ...prev, [type]: result }));
  }


  function markApplied(key: string) {
    setAppliedKey(key);
    setTimeout(() => setAppliedKey(null), 2000);
  }

  function handleCopy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  }

  function applyTitle(text: string, key: string) {
    setTitle(text);
    setTitleSuggestions(null);
    markApplied(key);
  }

  /**
   * Insert an internal link around `anchorText` inside `context`.
   * `path` is the server-validated URL path (/slug for pages, /post/slug for posts).
   * Refuses when the anchor overlaps an existing Markdown link or sits on a
   * heading or table row, so applying a suggestion can never corrupt a link.
   */
  function tryInsertInternalLink(anchorText: string, path: string, context: string): boolean {
    if (!/^\/[a-z0-9][a-z0-9/-]*$/.test(path) || path.includes("//")) return false;
    const content = editorRef.current?.getContent() ?? "";
    if (!anchorText.trim() || !content.includes(context)) return false;
    const linked = `[${anchorText}](${path})`;
    if (content.includes(linked)) return false;
    const at = context.indexOf(anchorText);
    if (at === -1) return false;
    const end = at + anchorText.length;
    for (const m of context.matchAll(/\[[^\]]*\]\([^)]*\)/g)) {
      const s0 = m.index ?? 0;
      if (at < s0 + m[0].length && end > s0) return false; // overlaps an existing link
    }
    if (/[\[\]]/.test(anchorText)) return false;
    const lineStart = content.lastIndexOf("\n", content.indexOf(context) + at) + 1;
    const line = content.slice(lineStart, content.indexOf("\n", lineStart) === -1 ? undefined : content.indexOf("\n", lineStart));
    if (/^\s*(#{1,6}\s|\|)/.test(line)) return false; // headings and table rows
    const updatedContext = context.slice(0, at) + linked + context.slice(end);
    editorRef.current?.setContent(content.replace(context, updatedContext));
    return true;
  }

  function insertOutline(outline: string[]) {
    const md = outline.map(s => `## ${s}\n\n`).join("");
    const current = editorRef.current?.getContent() ?? "";
    editorRef.current?.setContent(current ? `${current}\n\n${md}` : md);
  }

  return {
    // state
    pendingAction,
    aiError,
    aiUsage,
    titleSuggestions,
    setTitleSuggestions,
    excerptSuggestion,
    setExcerptSuggestion,
    swapPassageState,
    setSwapPassageState,
    refineResult,
    setRefineResult,
    refineFocusResult,
    setRefineFocusResult,
    readingLevel,
    setReadingLevel,
    dismissedIssues,
    setDismissedIssues,
    toneItems,
    setToneItems,
    catSuggestions,
    setCatSuggestions,
    tagSuggestions,
    setTagSuggestions,
    assistFeedback,
    setAssistFeedback,
    moreAiPending,
    moreAiResults,
    setMoreAiResults,
    agentRunning,
    agentCurrentStep,
    agentSummary,
    copiedKey,
    setCopiedKey,
    appliedKey,
    socialPlatform,
    setSocialPlatform,
    socialDraft,
    setSocialDraft,
    socialPending,
    // handlers
    handleSuggestTitles,
    handleGenerateSlug,
    handleSuggestExcerpt,
    handleSuggestSeo,
    handleRewrite,
    handleAssist,
    handleReadingLevel,
    handleToneCheck,
    handleRefineFocus,
    handleSocialPost,
    handleSuggestCategories,
    handleSuggestTags,
    handleGenerateAll,
    handleDraftAeo,
    runMoreAi,
    markApplied,
    handleCopy,
    applyTitle,
    tryInsertInternalLink,
    insertOutline,
    handleSwapPassage,
    applySwapPassage,
  };
}
