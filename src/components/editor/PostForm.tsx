"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import MarkdownEditor, { type MarkdownEditorHandle } from "@/components/editor/MarkdownEditor";
import AeoMetadataEditor, { type AeoMetadataEditorHandle, type AeoMetadata } from "@/components/editor/AeoMetadataEditor";
import TypeSelector from "@/components/admin/TypeSelector";
import TaxonomyPicker from "@/components/admin/TaxonomyPicker";
import PostImagePanel from "@/components/editor/PostImagePanel";
import { createCategoryInline } from "@/lib/actions/categories";
import { createTagInline } from "@/lib/actions/tags";

interface Category { id: number; name: string; slug: string; }
interface Tag { id: number; name: string; slug: string; }
interface Page { id: number; title: string; }
interface MediaItem { id: number; url: string; fileName: string; }

interface PostFormProps {
  mode: "create" | "edit";
  postId?: number;
  action: (formData: FormData) => Promise<void>;
  aiEnabled: boolean;
  initialTitle?: string;
  initialSlug?: string;
  initialContent?: string;
  initialExcerpt?: string;
  initialType?: "post" | "page";
  initialParentId?: number | null;
  initialAeoMetadata?: AeoMetadata | null;
  initialPublishAt?: string;
  allCategories: Category[];
  allTags: Tag[];
  allPages: Page[];
  initialCategoryIds?: number[];
  initialTagIds?: number[];
  allMedia: MediaItem[];
  initialFeaturedImageId?: number | null;
  initialFeaturedImageUrl?: string | null;
  initialFeatured?: boolean;
}

function parseJson<T>(raw: string): T {
  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  return JSON.parse(stripped) as T;
}

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function AiBtn({ label, onClick, pending, activeKey, myKey }: {
  label: string;
  onClick: () => void;
  pending: boolean;
  activeKey?: string | null;
  myKey?: string;
}) {
  const isActive = !!(myKey && activeKey === myKey);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={label}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-all
        ${isActive
          ? "bg-violet-600 border-violet-600 text-white cursor-wait"
          : pending
            ? "bg-violet-50 border-violet-200 text-violet-300 cursor-not-allowed"
            : "bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100 hover:border-violet-300"
        }`}
    >
      {isActive ? (
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )}
      {isActive ? "Working…" : label}
    </button>
  );
}


function AeoBadge({ aeo }: { aeo: AeoMetadata }) {
  const hasSummary = !!aeo.summary?.trim();
  const hasQa = (aeo.questions ?? []).some(q => q.q && q.a);
  const hasEntities = (aeo.entities ?? []).some(e => e.name);
  const dots = [hasSummary, hasQa, hasEntities];
  const count = dots.filter(Boolean).length;
  return (
    <div
      className="flex items-center gap-1"
      title={`AEO: ${count}/3 sections filled (summary · Q&A · entities)`}
    >
      {dots.map((filled, i) => (
        <span key={i} className={`w-2 h-2 rounded-full ${filled ? "bg-green-500" : "bg-zinc-200"}`} />
      ))}
      {count === 3 && (
        <span className="text-xs text-green-600 font-medium ml-0.5">Complete</span>
      )}
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  "internal-links": "Internal Link Suggestions",
  "meta-title": "Meta Title Variants",
  "headline-variants": "Headline Variants",
  "topic-report": "Topic Focus Report",
  "reading-level": "Reading Level",
  "brief": "Content Brief",
};

const ACTION_INSTRUCTIONS: Record<string, string> = {
  "internal-links": "Paste each link into your content where the anchor text fits naturally. Internal links improve SEO and keep readers engaged longer.",
  "meta-title": "Copy your preferred variant and paste it into the post title field above, or use it as the browser tab title via your SEO settings. Aim for under 60 characters.",
  "headline-variants": "Use one of these as your H1 or article title to improve click-through rates. The curiosity variant works well for social; the utility variant performs better in search.",
  "topic-report": "A low score means your content is too broad or unfocused. Narrow the angle, add more depth on the main topic, or break it into multiple posts.",
  "reading-level": "Most blog content targets grade 7–9. Adjust your sentence length and vocabulary to match your audience. Use shorter sentences and active voice to simplify.",
  "brief": "Use this as your writing roadmap before drafting. Accept the suggested title and excerpt into the fields above, then follow the outline as your structure.",
};

const SOCIAL_PLATFORMS: { id: string; label: string; limit: number }[] = [
  { id: "LinkedIn",  label: "LinkedIn",  limit: 3000 },
  { id: "X",         label: "X",         limit: 280  },
  { id: "Facebook",  label: "Facebook",  limit: 500  },
  { id: "Substack",  label: "Substack",  limit: 800  },
];

function extractAssociatedMedia(markdown: string, allMedia: MediaItem[]): MediaItem[] {
  const urls = new Set<string>();
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) urls.add(m[1]);
  return allMedia.filter(item => urls.has(item.url));
}

export default function PostForm({
  mode,
  postId,
  action,
  aiEnabled,
  initialTitle,
  initialSlug,
  initialContent,
  initialExcerpt,
  initialType,
  initialParentId,
  initialAeoMetadata,
  initialPublishAt,
  allCategories,
  allTags,
  allPages,
  initialCategoryIds,
  initialTagIds,
  allMedia,
  initialFeaturedImageId,
  initialFeaturedImageUrl,
  initialFeatured,
}: PostFormProps) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [slug, setSlug] = useState(initialSlug ?? "");
  const [excerpt, setExcerpt] = useState(initialExcerpt ?? "");
  const [publishAt, setPublishAt] = useState(initialPublishAt ?? "");
  const [sharedMedia, setSharedMedia] = useState<MediaItem[]>(allMedia);
  const [aeoMeta, setAeoMeta] = useState<AeoMetadata>(initialAeoMetadata ?? {});
  const [sessionMedia, setSessionMedia] = useState<MediaItem[]>([]);
  const [featuredId, setFeaturedId] = useState<number | null>(initialFeaturedImageId ?? null);
  const [currentType, setCurrentType] = useState<"post" | "page">(initialType ?? "post");
  const [slugEditing, setSlugEditing] = useState(false);
  const [slugManuallySet, setSlugManuallySet] = useState(!!initialSlug);
  const intentRef = useRef<HTMLInputElement>(null);

  function handleMediaUploaded(item: MediaItem) {
    setSharedMedia(prev => [item, ...prev]);
    setSessionMedia(prev => [item, ...prev]);
  }

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const aeoRef = useRef<AeoMetadataEditorHandle>(null);

  const [isDirty, setIsDirty] = useState(false);

  // Warn the user if they try to navigate away with unsaved changes.
  const handleBeforeUnload = useCallback((e: BeforeUnloadEvent) => {
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (isDirty) {
      window.addEventListener("beforeunload", handleBeforeUnload);
    } else {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    }
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, handleBeforeUnload]);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiUsage, setAiUsage] = useState<{ count: number; limit: number }>({ count: 0, limit: 50 });
  const [titleSuggestions, setTitleSuggestions] = useState<string[] | null>(null);
  const [refineResult, setRefineResult] = useState<string | null>(null);
  const [refineFocusResult, setRefineFocusResult] = useState<Array<{ label: string; passage?: string; recommendation: string }> | null>(null);
  const [toneItems, setToneItems] = useState<Array<{ quote: string; issue: string; suggestion: string }> | null>(null);
  const [catSuggestions, setCatSuggestions] = useState<string[] | null>(null);
  const [tagSuggestions, setTagSuggestions] = useState<string[] | null>(null);
  const [moreAiPending, setMoreAiPending] = useState(false);
  const [moreAiResults, setMoreAiResults] = useState<Record<string, string>>({});
  const [runAllPending, setRunAllPending] = useState<Set<string>>(new Set());
  const [briefFormOpen, setBriefFormOpen] = useState(false);
  const [briefAudience, setBriefAudience] = useState("");
  const [briefKeywords, setBriefKeywords] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const [socialPlatform, setSocialPlatform] = useState<string | null>(null);
  const [socialDraft, setSocialDraft] = useState<string>("");
  const [socialPending, setSocialPending] = useState(false);

  async function callAi(type: string, extra?: Record<string, unknown>): Promise<string | null> {
    setAiError(null);
    const content = editorRef.current?.getContent() ?? "";
    const endpoint = type === "refine" ? "/api/ai/refine" : "/api/ai/suggest";
    const body = type === "refine"
      ? { content, postTitle: title }
      : { content, postTitle: title, type, postId, ...extra };
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
    try { setTitleSuggestions(parseJson<string[]>(result)); }
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
    if (result) setExcerpt(result.trim());
  }

  async function handleRefine() {
    setPendingAction("refine");
    const result = await callAi("refine");
    setPendingAction(null);
    if (result) setRefineResult(result);
  }

  async function handleWrite() {
    setPendingAction("write");
    const content = editorRef.current?.getContent() ?? "";
    setAiError(null);
    try {
      const res = await fetch("/api/ai/refine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, postTitle: title, mode: "write" }),
      });
      const data = (await res.json()) as { result?: string; error?: string };
      if (!res.ok) { setAiError(data.error ?? "AI request failed"); }
      else if (data.result) { setRefineResult(data.result); }
    } catch { setAiError("Network error — please try again."); }
    setPendingAction(null);
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
    setPendingAction("generate-all");
    const [excerptResult, slugResult, catResult, tagResult, aeoResult, kwResult] = await Promise.all([
      callAi("excerpt"),
      slugManuallySet ? Promise.resolve(null) : callAi("slug"),
      callAi("categories"),
      callAi("tags", { existingTags: allTags.map(t => t.name) }),
      callAi("aeo"),
      callAi("keywords"),
    ]);
    setPendingAction(null);
    if (excerptResult) setExcerpt(excerptResult.trim());
    if (slugResult && !slugManuallySet) setSlug(slugResult.trim());
    if (catResult) { try { setCatSuggestions(parseJson<string[]>(catResult)); } catch { /* ignore */ } }
    if (tagResult) { try { setTagSuggestions(parseJson<string[]>(tagResult)); } catch { /* ignore */ } }
    if (aeoResult) {
      try {
        const parsed = parseJson<AeoMetadata>(aeoResult);
        if (kwResult) { try { parsed.keywords = parseJson<string[]>(kwResult); } catch { /* keep */ } }
        aeoRef.current?.setValue(parsed);
      } catch { setAiError("Could not parse AEO response. Try again."); }
    }
  }

  async function handleDraftAeo() {
    setPendingAction("aeo");
    const [aeoResult, kwResult] = await Promise.all([
      callAi("aeo"),
      callAi("keywords"),
    ]);
    setPendingAction(null);
    if (!aeoResult) return;
    try {
      const parsed = parseJson<AeoMetadata>(aeoResult);
      if (kwResult) {
        try { parsed.keywords = parseJson<string[]>(kwResult); } catch { /* keep existing */ }
      }
      aeoRef.current?.setValue(parsed);
      // onChange on AeoMetadataEditor will call setAeoMeta via the onChange prop
    } catch { setAiError("Could not parse AI response. Try again."); }
  }

  async function runMoreAi(type: string) {
    setMoreAiPending(true);
    const result = await callAi(type);
    setMoreAiPending(false);
    if (result) setMoreAiResults(prev => ({ ...prev, [type]: result }));
  }

  async function runBrief() {
    setMoreAiPending(true);
    setBriefFormOpen(false);
    try {
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "brief", postTitle: title, audience: briefAudience, keywords: briefKeywords }),
      });
      const data = (await res.json()) as { result?: string; error?: string };
      if (!res.ok) { setAiError(data.error ?? "AI request failed"); }
      else if (data.result) { setMoreAiResults(prev => ({ ...prev, brief: data.result! })); }
    } catch { setAiError("Network error — please try again."); }
    setMoreAiPending(false);
  }

  const RUN_ALL_TOOLS = [
    "excerpt", "categories", "tags", "aeo",
    "internal-links", "meta-title", "headline-variants", "topic-report", "reading-level",
  ] as const;

  async function handleRunAll() {
    setMoreAiResults({});
    setRunAllPending(new Set(RUN_ALL_TOOLS));

    function finish(tool: string) {
      setRunAllPending(prev => { const next = new Set(prev); next.delete(tool); return next; });
    }

    function applyInline(tool: string, result: string) {
      try {
        if (tool === "excerpt") { setExcerpt(result.trim()); return; }
        if (tool === "categories") { setCatSuggestions(parseJson<string[]>(result)); return; }
        if (tool === "tags") { setTagSuggestions(parseJson<string[]>(result)); return; }
        if (tool === "aeo") {
          const p = parseJson<AeoMetadata>(result);
          aeoRef.current?.setValue(p);
          // onChange on AeoMetadataEditor will call setAeoMeta via the onChange prop
          return;
        }
      } catch { /* ignore parse errors for inline tools */ }
    }

    await Promise.allSettled(
      RUN_ALL_TOOLS.map(tool =>
        callAi(tool).then(result => {
          if (!result) return;
          const isInline = ["excerpt", "categories", "tags", "aeo"].includes(tool);
          if (isInline) applyInline(tool, result);
          else setMoreAiResults(prev => ({ ...prev, [tool]: result }));
        }).finally(() => finish(tool))
      )
    );
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

  function tryInsertInternalLink(anchorText: string, slug: string, context: string): boolean {
    const content = editorRef.current?.getContent() ?? "";
    if (!content.includes(context)) return false;
    const linked = `[${anchorText}](/post/${slug})`;
    if (content.includes(linked)) return false;
    const updatedContext = context.replace(anchorText, linked);
    if (updatedContext === context) return false;
    editorRef.current?.setContent(content.replace(context, updatedContext));
    return true;
  }

  function insertOutline(outline: string[]) {
    const md = outline.map(s => `## ${s}\n\n`).join("");
    const current = editorRef.current?.getContent() ?? "";
    editorRef.current?.setContent(current ? `${current}\n\n${md}` : md);
  }

  function renderToolResult(action: string, result: string) {
    let content: React.ReactNode;
    try {
      if (action === "internal-links") {
        const suggestions = parseJson<Array<{ slug: string; title: string; anchorText: string; context: string }>>(result);
        content = suggestions.length === 0
          ? <p className="text-sm text-zinc-500">No strong internal linking opportunities found.</p>
          : (
            <ul className="divide-y divide-zinc-100">
              {suggestions.map((s, i) => {
                const md = `[${s.anchorText}](/post/${s.slug})`;
                const insertKey = `link-insert-${i}`;
                const copyKey = `link-copy-${i}`;
                return (
                  <li key={i} className="py-3 space-y-1.5">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{s.title}</p>
                    <code className="block text-xs text-zinc-600 font-mono">{md}</code>
                    <p className="text-xs text-zinc-400 italic">&ldquo;{s.context}&rdquo;</p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          const ok = tryInsertInternalLink(s.anchorText, s.slug, s.context);
                          if (ok) markApplied(insertKey);
                          else handleCopy(md, copyKey);
                        }}
                        className="text-xs text-zinc-700 hover:text-zinc-900 font-medium underline"
                      >
                        {appliedKey === insertKey ? "Inserted ✓" : "Insert into content"}
                      </button>
                      <button type="button" onClick={() => handleCopy(md, copyKey)} className="text-xs text-zinc-400 hover:text-zinc-600">
                        {copiedKey === copyKey ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          );
      } else if (action === "meta-title") {
        const variants = parseJson<{ title: string; reasoning: string }[]>(result);
        content = (
          <ul className="divide-y divide-zinc-100">
            {variants.map((v, i) => {
              const applyKey = `meta-apply-${i}`;
              const copyKey = `meta-copy-${i}`;
              return (
                <li key={i} className="py-3 space-y-1">
                  <p className="text-sm font-medium text-zinc-800">{v.title}</p>
                  <p className="text-xs text-zinc-400">{v.reasoning}</p>
                  <div className="flex items-center gap-3 pt-0.5">
                    <button type="button" onClick={() => applyTitle(v.title, applyKey)} className="text-xs text-zinc-700 hover:text-zinc-900 font-medium underline">
                      {appliedKey === applyKey ? "Applied ✓" : "Use as title"}
                    </button>
                    <button type="button" onClick={() => handleCopy(v.title, copyKey)} className="text-xs text-zinc-400 hover:text-zinc-600">
                      {copiedKey === copyKey ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        );
      } else if (action === "headline-variants") {
        const variants = parseJson<{ curiosity: string; utility: string }>(result);
        content = (
          <div className="divide-y divide-zinc-100">
            {(["curiosity", "utility"] as const).map(k => {
              const applyKey = `headline-apply-${k}`;
              const copyKey = `headline-copy-${k}`;
              return (
                <div key={k} className="py-3 space-y-1">
                  <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">{k}</p>
                  <p className="text-sm text-zinc-800">{variants[k]}</p>
                  <div className="flex items-center gap-3 pt-0.5">
                    <button type="button" onClick={() => applyTitle(variants[k], applyKey)} className="text-xs text-zinc-700 hover:text-zinc-900 font-medium underline">
                      {appliedKey === applyKey ? "Applied ✓" : "Use as title"}
                    </button>
                    <button type="button" onClick={() => handleCopy(variants[k], copyKey)} className="text-xs text-zinc-400 hover:text-zinc-600">
                      {copiedKey === copyKey ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      } else if (action === "topic-report") {
        const report = parseJson<{ topic: string; score: number; note: string }>(result);
        content = (
          <div className="space-y-3">
            <p className="text-base font-semibold text-zinc-800">{report.topic}</p>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <span key={n} className={`w-3 h-3 rounded-full ${n <= report.score ? "bg-zinc-800" : "bg-zinc-200"}`} />
              ))}
              <span className="text-xs text-zinc-500 ml-2">{report.score}/5</span>
            </div>
            <p className="text-sm text-zinc-600">{report.note}</p>
            {report.score < 5 && (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleSuggestTitles}
                  disabled={!!pendingAction}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Suggest Titles
                </button>
                <button
                  type="button"
                  onClick={handleRefineFocus}
                  disabled={!!pendingAction}
                  className={`inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border text-white disabled:cursor-not-allowed transition-colors ${
                    pendingAction === "refine-focus"
                      ? "btn-processing border-transparent"
                      : "bg-zinc-800 border-zinc-800 hover:bg-zinc-700 disabled:opacity-40"
                  }`}
                >
                  {pendingAction === "refine-focus" ? "Analyzing…" : "Refine Focus"}
                </button>
              </div>
            )}
          </div>
        );
      } else if (action === "reading-level") {
        const rl = parseJson<{ level: string; gradeLevel: number; note: string; fit?: string }>(result);
        const fitColor = rl.fit === "fits voice" ? "bg-green-100 text-green-700"
          : rl.fit === "too complex" ? "bg-red-100 text-red-700"
          : rl.fit === "too simple" ? "bg-yellow-100 text-yellow-700" : "";
        content = (
          <div className="space-y-3">
            <span className="text-sm font-semibold text-zinc-800">{rl.level}</span>
            <p className="text-sm text-zinc-600">Grade {rl.gradeLevel} equivalent</p>
            <p className="text-sm text-zinc-600">{rl.note}</p>
            {rl.fit && <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${fitColor}`}>{rl.fit}</span>}
          </div>
        );
      } else if (action === "brief") {
        const brief = parseJson<{
          suggestedTitle: string; angle: string; targetAudience: string;
          recommendedWordCount: number; outline: string[]; keyPoints: string[];
          anglesToAvoid: string[]; suggestedExcerpt: string;
        }>(result);
        content = (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Suggested Title</p>
              <p className="text-zinc-800 font-medium mb-1.5">{brief.suggestedTitle}</p>
              <button type="button" onClick={() => applyTitle(brief.suggestedTitle, "brief-title")} className="text-xs text-zinc-700 hover:text-zinc-900 font-medium underline">
                {appliedKey === "brief-title" ? "Applied ✓" : "Use as title"}
              </button>
            </div>
            {[
              { label: "Angle", value: brief.angle },
              { label: "Target Audience", value: brief.targetAudience },
              { label: "Recommended Word Count", value: `${brief.recommendedWordCount.toLocaleString()} words` },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">{label}</p>
                <p className="text-zinc-700">{value}</p>
              </div>
            ))}
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Outline</p>
              <ul className="space-y-0.5 mb-2">
                {brief.outline.map((s, i) => (
                  <li key={i} className="text-zinc-700 text-xs flex gap-1.5">
                    <span className="text-zinc-300 shrink-0 font-mono">{i + 1}.</span>{s}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => { insertOutline(brief.outline); markApplied("brief-outline"); }}
                className="text-xs text-zinc-700 hover:text-zinc-900 font-medium underline"
              >
                {appliedKey === "brief-outline" ? "Inserted ✓" : "Insert outline into editor"}
              </button>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Key Points</p>
              <ul className="space-y-0.5">{brief.keyPoints.map((p, i) => <li key={i} className="text-zinc-700 text-xs flex gap-1.5"><span className="text-zinc-300 shrink-0">•</span>{p}</li>)}</ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Angles to Avoid</p>
              <ul className="space-y-0.5">{brief.anglesToAvoid.map((a, i) => <li key={i} className="text-zinc-700 text-xs flex gap-1.5"><span className="text-red-300 shrink-0">✕</span>{a}</li>)}</ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-1">Suggested Excerpt</p>
              <p className="text-zinc-600 italic text-xs mb-1.5">{brief.suggestedExcerpt}</p>
              <button
                type="button"
                onClick={() => { setExcerpt(brief.suggestedExcerpt); markApplied("brief-excerpt"); }}
                className="text-xs text-zinc-700 hover:text-zinc-900 font-medium underline"
              >
                {appliedKey === "brief-excerpt" ? "Applied ✓" : "Use as excerpt"}
              </button>
            </div>
          </div>
        );
      } else {
        content = <p className="text-sm text-zinc-700 whitespace-pre-wrap">{result}</p>;
      }
    } catch {
      content = <p className="text-sm text-zinc-700 whitespace-pre-wrap">{result}</p>;
    }

    const instruction = ACTION_INSTRUCTIONS[action];

    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold tracking-widest text-zinc-700 uppercase">{ACTION_LABELS[action] ?? action}</span>
          <button type="button" onClick={() => setMoreAiResults(prev => { const n = { ...prev }; delete n[action]; return n; })} className="text-xs text-zinc-500 hover:text-zinc-700 transition-colors">Dismiss</button>
        </div>
        <div className="max-h-64 overflow-y-auto">{content}</div>
      </div>
    );
  }

  const pageLabel = mode === "edit"
    ? `Edit ${initialType === "page" ? "Page" : "Post"}`
    : "New Content";

  const isScheduled = publishAt && new Date(publishAt) > new Date();

  function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
      <p className="text-xs font-semibold tracking-widest text-zinc-700 uppercase mb-3">{children}</p>
    );
  }

  function RunBtn({ tool, label }: { tool: string; label: string }) {
    const running = runAllPending.has(tool) || (moreAiPending && !runAllPending.size);
    const done = !!moreAiResults[tool];
    return (
      <button
        type="button"
        disabled={moreAiPending || runAllPending.size > 0}
        onClick={() => runMoreAi(tool)}
        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {runAllPending.has(tool) ? (
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        ) : done ? (
          <span className="text-green-500">✓</span>
        ) : (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )}
        {running && !runAllPending.has(tool) ? "Running…" : label}
      </button>
    );
  }

  return (
    <div
      className={`-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 px-4 sm:px-6 pt-4 sm:pt-6 transition-colors duration-500 ${isDirty ? "bg-amber-50" : "bg-zinc-50"}`}
      onChange={() => { if (!isDirty) setIsDirty(true); }}
    >
      {/* Fixed action bar — sits flush under TopBar (h-14) and to the right of the sidebar (lg:left-56) */}
      <div className="fixed top-14 inset-x-0 lg:left-56 z-20 bg-white border-b border-zinc-100 px-4 sm:px-6 py-3 flex items-center gap-4">
        <Link href="/admin/posts" className="text-sm text-zinc-400 hover:text-zinc-700 transition-colors shrink-0">
          ← Content
        </Link>
        <span className="text-sm text-zinc-400">/</span>
        <h1 className="text-sm font-medium text-zinc-900 truncate flex-1">{pageLabel}</h1>
        {aiError && (
          <p className="text-xs text-red-500 truncate max-w-xs hidden sm:block">{aiError}</p>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/admin/posts"
            className="px-3 py-1.5 rounded-lg text-sm text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            form="post-form"
            onClick={() => { if (intentRef.current) intentRef.current.value = "draft"; }}
            className="px-3 py-1.5 rounded-lg border border-zinc-200 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            Save Draft
          </button>
          <button
            type="submit"
            form="post-form"
            onClick={() => { if (intentRef.current) intentRef.current.value = "publish"; }}
            className="px-3 py-1.5 rounded-lg bg-[var(--ds-blue-1000)] text-white text-sm font-medium hover:bg-[var(--ds-blue-900)] transition-colors"
          >
            {isScheduled ? "Schedule" : "Publish"}
          </button>
        </div>
      </div>

      {/* Spacer — matches fixed bar height so content doesn't hide underneath it */}
      <div className="h-12 shrink-0" />

      {aiError && (
        <p className="text-xs text-red-500 mb-4">{aiError}</p>
      )}

      <form id="post-form" action={action} onSubmit={() => setIsDirty(false)} className="space-y-4">
        <input ref={intentRef} type="hidden" name="intent" defaultValue="publish" />

        {/* Content type — compact bar */}
        <div className="bg-white border border-zinc-200 rounded-lg px-4 py-3">
          <div className="grid grid-cols-3 gap-4 items-center">
            {/* Col 1: Post / Page toggle */}
            <TypeSelector
              defaultType={initialType ?? "post"}
              onTypeChange={setCurrentType}
            />

            {/* Col 2: Pin (post only) */}
            <div>
              {currentType === "post" && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="featured"
                    value="1"
                    defaultChecked={initialFeatured ?? false}
                    className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400"
                  />
                  <span className="text-sm text-zinc-600">Pin as featured</span>
                </label>
              )}
            </div>

            {/* Col 3: Publish date (post) or Parent page (page) */}
            <div>
              {currentType === "page" ? (
                <select
                  name="parentId"
                  defaultValue={initialParentId ?? ""}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-400"
                >
                  <option value="">No parent page</option>
                  {allPages.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="datetime-local"
                  name="publishAt"
                  value={publishAt}
                  onChange={e => setPublishAt(e.target.value)}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm bg-white text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                />
              )}
            </div>
          </div>
        </div>

        {/* Title + Slug */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Title</SectionLabel>
            {aiEnabled && (
              <AiBtn label="Suggest titles" pending={!!pendingAction} activeKey={pendingAction} myKey="titles" onClick={handleSuggestTitles} />
            )}
          </div>
          <input
            name="title"
            required
            value={title}
            onChange={e => {
              const next = e.target.value;
              setTitle(next);
              setTitleSuggestions(null);
              if (!slugManuallySet) setSlug(toSlug(next));
            }}
            className="w-full border border-zinc-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-zinc-400"
            placeholder="Post title"
          />

          {/* Slug — inline below title */}
          <input type="hidden" name="slug" value={slug} />
          <div className="mt-2 flex items-center gap-2 min-h-[1.5rem]">
            <span className="text-xs text-zinc-600 shrink-0">Slug:</span>
            {slugEditing ? (
              <input
                autoFocus
                value={slug}
                onChange={e => { setSlug(e.target.value); setSlugManuallySet(true); }}
                onBlur={() => setSlugEditing(false)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setSlugEditing(false); } }}
                className="text-xs font-mono border-b border-zinc-400 focus:border-zinc-700 outline-none bg-transparent text-zinc-700 py-0.5 flex-1"
                placeholder="my-post-slug"
              />
            ) : (
              <>
                <span className="text-xs font-mono text-zinc-500">
                  {slug || <em className="not-italic text-zinc-300">auto-generated from title</em>}
                </span>
                <button
                  type="button"
                  onClick={() => setSlugEditing(true)}
                  className="text-zinc-300 hover:text-zinc-600 transition-colors shrink-0"
                  title="Edit slug"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
                {slug && slugManuallySet && (
                  <button
                    type="button"
                    onClick={() => { setSlug(toSlug(title)); setSlugManuallySet(false); }}
                    className="text-xs text-zinc-300 hover:text-zinc-500 transition-colors shrink-0"
                    title="Reset to auto-generated"
                  >
                    reset
                  </button>
                )}
                {aiEnabled && (
                  <AiBtn label="Generate" pending={!!pendingAction} activeKey={pendingAction} myKey="slug" onClick={handleGenerateSlug} />
                )}
              </>
            )}
          </div>

          {titleSuggestions && (
            <div className="mt-3 space-y-1">
              <p className="text-xs text-zinc-600 mb-1.5">Suggested — click to use:</p>
              {titleSuggestions.map((t, i) => (
                <button
                  key={i} type="button"
                  onClick={() => {
                    setTitle(t);
                    setTitleSuggestions(null);
                    if (!slugManuallySet) setSlug(toSlug(t));
                  }}
                  className="block w-full text-left text-sm text-zinc-700 hover:text-zinc-900 px-2 py-1 rounded hover:bg-zinc-100 transition-colors"
                >{t}</button>
              ))}
              <button type="button" onClick={() => setTitleSuggestions(null)} className="text-xs text-zinc-500 hover:text-zinc-600 px-2">Dismiss</button>
            </div>
          )}
        </div>

        {/* Content + Image Panel — flex row on desktop, stacked on mobile */}
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">
          {/* Editor card — 80% */}
          <div className="bg-white border border-zinc-200 rounded-lg p-6 min-w-0 lg:flex-[4]">
              <div className="flex items-center justify-between mb-3">
                <SectionLabel>Content</SectionLabel>
                {aiEnabled && (
                  <div className="flex items-center gap-4">
                    <AiBtn label="Write" pending={!!pendingAction} activeKey={pendingAction} myKey="write" onClick={handleWrite} />
                    <AiBtn label="Refine" pending={!!pendingAction} activeKey={pendingAction} myKey="refine" onClick={handleRefine} />
                    <AiBtn label="Tone check" pending={!!pendingAction} activeKey={pendingAction} myKey="tone-check" onClick={handleToneCheck} />
                  </div>
                )}
              </div>

              {toneItems && (
                <div className="mb-4 space-y-3">
                  <p className="text-xs font-semibold tracking-widest text-zinc-700 uppercase">Tone suggestions</p>
                  {toneItems.length === 0 && <p className="text-xs text-zinc-600">Content matches your voice guide well.</p>}
                  {toneItems.map((item, i) => (
                    <div key={i} className="border border-zinc-200 rounded-lg p-3 bg-white space-y-1.5">
                      <p className="text-xs text-zinc-600 italic truncate">&ldquo;{item.quote}&rdquo;</p>
                      <p className="text-xs text-red-500">{item.issue}</p>
                      <p className="text-xs text-zinc-700">{item.suggestion}</p>
                      <button
                        type="button"
                        onClick={() => {
                          const current = editorRef.current?.getContent() ?? "";
                          const updated = current.replace(item.quote, item.suggestion);
                          if (updated !== current) editorRef.current?.setContent(updated);
                          setToneItems(prev => { const next = prev?.filter((_, j) => j !== i) ?? []; return next.length ? next : null; });
                        }}
                        className="text-xs text-zinc-700 hover:text-zinc-900 font-medium underline"
                      >Apply fix →</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setToneItems(null)} className="text-xs text-zinc-500 hover:text-zinc-600">Dismiss all</button>
                </div>
              )}

              {refineResult && (
                <div className="mb-4 border border-zinc-200 rounded-lg p-4 bg-white space-y-3">
                  <p className="text-xs font-semibold tracking-widest text-zinc-700 uppercase">AI draft — review before accepting</p>
                  <p className="text-sm text-zinc-700 whitespace-pre-wrap max-h-56 overflow-y-auto">{refineResult}</p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { editorRef.current?.setContent(refineResult); setRefineResult(null); }}
                      className="text-xs text-zinc-700 hover:text-zinc-900 font-medium underline"
                    >Accept</button>
                    <button type="button" onClick={() => setRefineResult(null)} className="text-xs text-zinc-500 hover:text-zinc-600">Dismiss</button>
                  </div>
                </div>
              )}

              <MarkdownEditor
                ref={editorRef}
                name="content"
                defaultValue={initialContent}
                placeholder="Write your content here..."
                allMedia={sharedMedia}
                aiEnabled={aiEnabled}
                postTitle={title}
                onMediaUploaded={handleMediaUploaded}
              />
          </div>

          {/* Image panel card — 20%, sticky on desktop */}
          <div className="bg-white border border-zinc-200 rounded-lg p-3 lg:flex-[1] lg:sticky lg:top-[52px] lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-widest text-zinc-700 uppercase shrink-0">Images</p>
            {featuredId !== null && (
              <>
                <input type="hidden" name="featuredImage" value={featuredId} />
                {(() => {
                  const featuredUrl = sharedMedia.find(m => m.id === featuredId)?.url ?? initialFeaturedImageUrl;
                  return featuredUrl ? (
                    <div className="shrink-0">
                      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Featured image</p>
                      <div className="relative rounded-md overflow-hidden bg-zinc-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={featuredUrl} alt="Featured" className="w-full object-cover max-h-32" />
                        <button
                          type="button"
                          onClick={() => setFeaturedId(null)}
                          className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center transition-colors"
                          title="Remove featured image"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ) : null;
                })()}
              </>
            )}
            <PostImagePanel
              mode={mode}
              sessionMedia={sessionMedia}
              associatedMedia={mode === "edit" ? extractAssociatedMedia(initialContent ?? "", sharedMedia) : []}
              allMedia={sharedMedia}
              featuredId={featuredId}
              onFeaturedChange={setFeaturedId}
              onInsert={(url, alt) => editorRef.current?.insertImage(url, alt)}
              onUpload={handleMediaUploaded}
              postTitle={title}
            />
          </div>
        </div>

        {/* Excerpt */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Excerpt</SectionLabel>
            {aiEnabled && (
              <AiBtn label="Suggest" pending={!!pendingAction} activeKey={pendingAction} myKey="excerpt" onClick={handleSuggestExcerpt} />
            )}
          </div>
          <input
            name="excerpt"
            value={excerpt}
            onChange={e => setExcerpt(e.target.value)}
            className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
            placeholder="Short description for search engines and previews..."
          />
        </div>

        {/* Categories */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6">
          <TaxonomyPicker
            label="Categories"
            fieldName="categories"
            items={allCategories}
            selectedIds={initialCategoryIds ? new Set(initialCategoryIds) : undefined}
            onCreate={createCategoryInline}
            onAiSuggest={aiEnabled ? handleSuggestCategories : undefined}
            aiPending={!!pendingAction}
            suggestions={catSuggestions ?? undefined}
            onSuggestDismiss={() => setCatSuggestions(null)}
          />
        </div>

        {/* Tags */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6">
          <TaxonomyPicker
            label="Tags"
            fieldName="tags"
            items={allTags}
            selectedIds={initialTagIds ? new Set(initialTagIds) : undefined}
            onCreate={createTagInline}
            onAiSuggest={aiEnabled ? handleSuggestTags : undefined}
            aiPending={!!pendingAction}
            suggestions={tagSuggestions ?? undefined}
            onSuggestDismiss={() => setTagSuggestions(null)}
          />
        </div>

        {/* Generate All AEO Metadata */}
        {aiEnabled && (
          <div className="bg-white border border-zinc-200 rounded-lg px-6 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-800">Generate all metadata</p>
              <p className="text-xs text-zinc-400 mt-0.5">Fills excerpt, slug, categories, tags, and AEO in one shot.</p>
            </div>
            <button
              type="button"
              onClick={handleGenerateAll}
              disabled={!!pendingAction}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium disabled:cursor-not-allowed shrink-0 transition-colors ${
                pendingAction === "generate-all"
                  ? "btn-processing"
                  : "bg-zinc-900 hover:bg-zinc-700 disabled:opacity-40"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {pendingAction === "generate-all" ? "Generating…" : "Generate All AEO Metadata"}
            </button>
          </div>
        )}

        {/* AI usage meter */}
        {aiEnabled && (() => {
          const { count, limit } = aiUsage;
          const pct       = Math.min(count / limit * 100, 100);
          const barColor  = count >= 40 ? "bg-red-500"    : count >= 30 ? "bg-orange-500" : count >= 20 ? "bg-amber-400" : "bg-green-500";
          const textColor = count >= 40 ? "text-red-600"  : count >= 30 ? "text-orange-600" : count >= 20 ? "text-amber-600" : "text-zinc-400";
          const label     = count >= limit
            ? "Limit reached — resets in under 1 hour"
            : `${count} / ${limit} AI calls this hour`;
          return (
            <div className="bg-white border border-zinc-200 rounded-lg px-6 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-zinc-400">AI usage</span>
                <span className={`text-xs font-medium ${textColor}`}>{label}</span>
              </div>
              <div className="w-full h-1 bg-zinc-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })()}

        {/* AEO Metadata */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <SectionLabel>AEO Metadata</SectionLabel>
              <div className="-mt-3">
                <AeoBadge aeo={aeoMeta} />
              </div>
            </div>
            {aiEnabled && (
              <AiBtn label="Generate AEO" pending={!!pendingAction} activeKey={pendingAction} myKey="aeo" onClick={handleDraftAeo} />
            )}
          </div>
          <AeoMetadataEditor
            ref={aeoRef}
            name="aeoMetadata"
            defaultValue={initialAeoMetadata}
            onChange={setAeoMeta}
          />
        </div>


        {/* ── AI Analysis sections ── */}
        {aiEnabled && (
          <>
            {/* Section divider label */}
            <div className="pt-2 pb-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold tracking-widest text-zinc-700 uppercase">AI Analysis</p>
                <button
                  type="button"
                  disabled={runAllPending.size > 0}
                  onClick={handleRunAll}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {runAllPending.size > 0 ? (
                    <>
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      {runAllPending.size} running…
                    </>
                  ) : "Run all"}
                </button>
              </div>
            </div>

            {/* Content Brief */}
            <div className="bg-white border border-zinc-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-1.5">
                <SectionLabel>Content Brief</SectionLabel>
                <button
                  type="button"
                  disabled={moreAiPending || runAllPending.size > 0}
                  onClick={() => setBriefFormOpen(o => !o)}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-40 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate
                </button>
              </div>
              <p className="text-xs text-zinc-600 mb-3">{ACTION_INSTRUCTIONS["brief"]}</p>
              {briefFormOpen && (
                <div className="space-y-2 mb-4">
                  <input type="text" placeholder="Target audience (optional)" value={briefAudience} onChange={e => setBriefAudience(e.target.value)} className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm" />
                  <input type="text" placeholder="Keywords, comma-separated (optional)" value={briefKeywords} onChange={e => setBriefKeywords(e.target.value)} className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm" />
                  <div className="flex gap-2">
                    <button type="button" onClick={runBrief} disabled={moreAiPending} className="text-xs px-3 py-1.5 rounded-lg bg-[var(--ds-blue-1000)] text-white hover:bg-[var(--ds-blue-900)] disabled:opacity-50 transition">Generate</button>
                    <button type="button" onClick={() => setBriefFormOpen(false)} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition">Cancel</button>
                  </div>
                </div>
              )}
              {moreAiResults["brief"] && renderToolResult("brief", moreAiResults["brief"])}
            </div>

            {/* Meta Titles */}
            <div className="bg-white border border-zinc-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-1.5">
                <SectionLabel>Meta Titles</SectionLabel>
                <RunBtn tool="meta-title" label="Run" />
              </div>
              <p className="text-xs text-zinc-600 mb-3">{ACTION_INSTRUCTIONS["meta-title"]}</p>
              {moreAiResults["meta-title"] && renderToolResult("meta-title", moreAiResults["meta-title"])}
            </div>

            {/* Headline Variants */}
            <div className="bg-white border border-zinc-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-1.5">
                <SectionLabel>Headline Variants</SectionLabel>
                <RunBtn tool="headline-variants" label="Run" />
              </div>
              <p className="text-xs text-zinc-600 mb-3">{ACTION_INSTRUCTIONS["headline-variants"]}</p>
              {moreAiResults["headline-variants"] && renderToolResult("headline-variants", moreAiResults["headline-variants"])}
            </div>

            {/* Topic Focus */}
            <div className="bg-white border border-zinc-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-1.5">
                <SectionLabel>Topic Focus</SectionLabel>
                <RunBtn tool="topic-report" label="Run" />
              </div>
              <p className="text-xs text-zinc-600 mb-3">{ACTION_INSTRUCTIONS["topic-report"]}</p>
              {moreAiResults["topic-report"] && renderToolResult("topic-report", moreAiResults["topic-report"])}
              {refineFocusResult && refineFocusResult.length === 0 && (
                <p className="mt-3 text-xs text-green-600 font-medium">Post is well-focused — no issues found.</p>
              )}
              {refineFocusResult && refineFocusResult.length > 0 && (
                <div className="mt-4 space-y-2">
                  {refineFocusResult.map((issue, i) => (
                    <div key={i} className="p-3 bg-amber-50 border-l-2 border-amber-400 rounded-r">
                      <p className="text-xs font-semibold text-zinc-800">{issue.label}</p>
                      {issue.passage && (
                        <p className="text-xs text-zinc-500 italic mt-0.5">&ldquo;{issue.passage}&rdquo;</p>
                      )}
                      <p className="text-xs text-zinc-700 mt-1">{issue.recommendation}</p>
                    </div>
                  ))}
                  <button type="button" onClick={() => setRefineFocusResult(null)} className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors">
                    Dismiss
                  </button>
                </div>
              )}
            </div>

            {/* Reading Level */}
            <div className="bg-white border border-zinc-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-1.5">
                <SectionLabel>Reading Level</SectionLabel>
                <RunBtn tool="reading-level" label="Run" />
              </div>
              <p className="text-xs text-zinc-600 mb-3">{ACTION_INSTRUCTIONS["reading-level"]}</p>
              {moreAiResults["reading-level"] && renderToolResult("reading-level", moreAiResults["reading-level"])}
            </div>

            {/* Internal Links */}
            <div className="bg-white border border-zinc-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-1.5">
                <SectionLabel>Internal Links</SectionLabel>
                <RunBtn tool="internal-links" label="Run" />
              </div>
              <p className="text-xs text-zinc-600 mb-3">{ACTION_INSTRUCTIONS["internal-links"]}</p>
              {moreAiResults["internal-links"] && renderToolResult("internal-links", moreAiResults["internal-links"])}
            </div>

            {/* Social Post Generator */}
            <div className="bg-white border border-zinc-200 rounded-lg p-6">
              <div className="mb-3">
                <SectionLabel>Social Post</SectionLabel>
                <p className="text-xs text-zinc-600">Generate a platform-ready post draft. Click a platform to generate — click again to regenerate.</p>
              </div>
              <div className="flex gap-2 flex-wrap mb-3">
                {SOCIAL_PLATFORMS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSocialPost(p.id)}
                    disabled={socialPending}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                      socialPlatform === p.id && socialPending
                        ? "border-blue-500 text-blue-700 bg-blue-50 opacity-100 cursor-wait"
                        : socialPlatform === p.id && !socialPending
                          ? "border-blue-500 bg-blue-500 text-white"
                          : socialPending
                            ? "border-zinc-100 text-zinc-300 bg-white cursor-not-allowed"
                            : "border-zinc-200 text-zinc-600 bg-white hover:border-blue-300 hover:text-blue-600"
                    }`}
                  >
                    {socialPlatform === p.id && socialPending ? "Generating…" : p.label}
                  </button>
                ))}
              </div>
              {socialPending && (
                <div className="h-1.5 rounded-full overflow-hidden mb-3">
                  <div className="h-full w-full btn-processing rounded-full" />
                </div>
              )}
              {socialDraft && !socialPending && (() => {
                const plat = SOCIAL_PLATFORMS.find(p => p.id === socialPlatform);
                const limit = plat?.limit ?? Infinity;
                const over = socialDraft.length > limit;
                return (
                  <div className="space-y-2">
                    <textarea
                      value={socialDraft}
                      onChange={e => setSocialDraft(e.target.value)}
                      rows={5}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm text-zinc-800 resize-y focus:outline-none focus:ring-2 focus:ring-zinc-400"
                    />
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-mono ${over ? "text-red-500 font-semibold" : "text-zinc-400"}`}>
                        {socialDraft.length}{limit !== Infinity ? ` / ${limit}` : ""}
                        {over && ` — ${socialDraft.length - limit} over limit`}
                      </span>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(socialDraft).then(() => {
                          setCopiedKey("social");
                          setTimeout(() => setCopiedKey(null), 2000);
                        })}
                        className="text-xs text-zinc-500 hover:text-zinc-800 font-medium transition-colors"
                      >
                        {copiedKey === "social" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}

        {/* Bottom actions */}
        <div className="flex items-center justify-end gap-2 pt-2 pb-6">
          <Link
            href="/admin/posts"
            className="px-4 py-2 rounded-lg text-sm text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            onClick={() => { if (intentRef.current) intentRef.current.value = "draft"; }}
            className="px-4 py-2 rounded-lg border border-zinc-200 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            Save Draft
          </button>
          <button
            type="submit"
            onClick={() => { if (intentRef.current) intentRef.current.value = "publish"; }}
            className="px-4 py-2 rounded-lg bg-[var(--ds-blue-1000)] text-white text-sm font-medium hover:bg-[var(--ds-blue-900)] transition-colors"
          >
            {isScheduled ? "Schedule" : "Publish"}
          </button>
        </div>
      </form>
    </div>
  );
}
