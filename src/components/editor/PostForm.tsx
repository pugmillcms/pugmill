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
import { autosavePost } from "@/lib/actions/posts";
import { updateMediaAltText } from "@/lib/actions/media";
import { useAiTools, parseJson } from "@/components/editor/useAiTools";
import SerpPreview from "@/components/editor/SerpPreview";

interface Category { id: number; name: string; slug: string; }
interface Tag { id: number; name: string; slug: string; }
interface Page { id: number; title: string; }
interface MediaItem { id: number; url: string; fileName: string; altText?: string | null; }

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
  initialSeoTitle?: string;
  initialSeoMetaDescription?: string;
  initialRobotsNoindex?: boolean;
  initialRobotsNofollow?: boolean;
  initialCanonicalUrl?: string;
  initialOgImageUrl?: string;
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
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border transition-all
        ${isActive
          ? "btn-processing border-transparent text-white cursor-wait"
          : pending
            ? "bg-violet-50 border-violet-200 text-violet-300 cursor-not-allowed"
            : "bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100 hover:border-violet-300"
        }`}
    >
      {isActive ? (
        <svg className="w-2.5 h-2.5 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )}
      {isActive ? "Working…" : label}
    </button>
  );
}



// ── AEO Health panel ──────────────────────────────────────────────────────────

const AEO_HEALTH_CRITERIA: { key: string; label: string; pts: number; tip: string; fixTool?: string; scrollTo?: string }[] = [
  { key: "content-length",       label: "400+ words",                  pts: 15, tip: "Write at least 400 words for meaningful content depth." },
  { key: "has-headings",         label: "H2/H3 subheadings present",   pts: 10, tip: "Add subheadings to structure the content." },
  { key: "no-h1",                label: "No H1 in body",               pts:  5, tip: "Remove any # H1 headings — the post title already provides one." },
  { key: "opening-concise",      label: "Opening para ≤ 80 words",     pts:  5, tip: "Shorten your first paragraph to make it scannable." },
  { key: "summary",              label: "Summary written",             pts: 10, tip: "Add a 2–3 sentence summary for AI crawlers.",          fixTool: "aeo" },
  { key: "summary-length",       label: "Summary 80+ chars",           pts:  5, tip: "Expand your summary to at least 80 characters.",       fixTool: "aeo" },
  { key: "qa-1",                 label: "At least 1 Q&A pair",         pts: 10, tip: "Add a Q&A pair to generate FAQPage schema.",           fixTool: "aeo" },
  { key: "qa-3",                 label: "3+ Q&A pairs",                pts:  5, tip: "Add at least 3 Q&A pairs for better coverage.",        fixTool: "aeo" },
  { key: "entities",             label: "Named entity tagged",         pts: 10, tip: "Tag key people, orgs, products, or concepts.",         fixTool: "aeo" },
  { key: "keywords",             label: "5+ keywords",                 pts: 10, tip: "Add 5–10 search-focused keywords.",                    fixTool: "aeo" },
  { key: "keywords-in-content",  label: "Keywords found in content",   pts: 10, tip: "Ensure your AEO keywords appear naturally in the post body." },
  { key: "featured-image-alt",   label: "Featured image has alt text", pts:  5, tip: "Set alt text on the featured image for accessibility and SEO.", scrollTo: "featured-image-alt-input" },
];

function countWords(text: string): number {
  return text.replace(/#+\s|[*_`~\[\]()!]/g, "").trim().split(/\s+/).filter(Boolean).length;
}

function calcAeoHealth(aeo: AeoMetadata, content: string, featuredAlt: string | null | undefined) {
  const summary   = aeo.summary?.trim() ?? "";
  const questions = (aeo.questions ?? []).filter(q => q.q && q.a);
  const entities  = (aeo.entities  ?? []).filter(e => e.name);
  const keywords  = (aeo.keywords  ?? []).filter(k => k.trim());

  // Content-based checks
  const wordCount = content ? countWords(content) : 0;
  const hasH2H3   = /^#{2,3}\s/m.test(content);
  const hasH1     = /^#\s/m.test(content);
  const firstPara = content.split(/\n\s*\n/)[0]?.trim() ?? "";
  const openingWords = countWords(firstPara);
  const contentLower = content.toLowerCase();
  const keywordsInContent = keywords.length > 0 && keywords.some(k => contentLower.includes(k.toLowerCase()));

  const passed: Record<string, boolean> = {
    "content-length":      wordCount >= 400,
    "has-headings":        hasH2H3,
    "no-h1":               !hasH1,
    "opening-concise":     openingWords > 0 && openingWords <= 80,
    "summary":             summary.length > 0,
    "summary-length":      summary.length >= 80,
    "qa-1":                questions.length >= 1,
    "qa-3":                questions.length >= 3,
    "entities":            entities.length >= 1,
    "keywords":            keywords.length >= 5,
    "keywords-in-content": keywordsInContent,
    "featured-image-alt":  !!featuredAlt?.trim(),
  };

  const items = AEO_HEALTH_CRITERIA.map(c => ({ ...c, pass: passed[c.key] }));
  const score = items.reduce((s, i) => s + (i.pass ? i.pts : 0), 0);
  return { score, items };
}

function AeoHealthPanel({ aeo, content, featuredAlt, aiEnabled, onGenerateAll, generating, currentStep, summary }: {
  aeo: AeoMetadata;
  content: string;
  featuredAlt?: string | null;
  aiEnabled: boolean;
  onGenerateAll?: () => void;
  generating?: boolean;
  currentStep?: string | null;
  summary?: { step: string; applied: boolean; detail: string }[] | null;
}) {
  const { score, items } = calcAeoHealth(aeo, content, featuredAlt);
  const grade    = score >= 90 ? "Excellent" : score >= 70 ? "Good" : score >= 40 ? "Fair" : "Poor";
  const barCls   = score >= 90 ? "bg-green-500" : score >= 70 ? "bg-blue-500" : score >= 40 ? "bg-amber-400" : "bg-red-400";
  const scoreCls = score >= 90 ? "text-green-600" : score >= 70 ? "text-blue-600" : score >= 40 ? "text-amber-500" : "text-red-500";

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">AEO Health</p>
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className={`text-3xl font-bold leading-none ${scoreCls}`}>{score}</span>
        <span className="text-sm text-zinc-300">/100</span>
        <span className={`text-xs font-semibold ml-auto ${scoreCls}`}>{grade}</span>
      </div>
      <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden mb-4">
        <div className={`h-full rounded-full transition-all duration-500 ${barCls}`} style={{ width: `${score}%` }} />
      </div>
      <ul className="space-y-2.5">
        {items.map(item => (
          <li key={item.key} className="flex items-start gap-2">
            <span className={`mt-px text-xs font-bold shrink-0 ${item.pass ? "text-green-500" : "text-zinc-300"}`}>
              {item.pass ? "✓" : "○"}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className={`text-xs ${item.pass ? "text-zinc-700" : "text-zinc-400"}`}>{item.label}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!item.pass && item.scrollTo && (
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById(item.scrollTo!);
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                          setTimeout(() => el.focus(), 400);
                        }
                      }}
                      className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 transition-all"
                    >
                      Set
                    </button>
                  )}
                  <span className={`text-[10px] ${item.pass ? "text-green-500" : "text-zinc-300"}`}>+{item.pts}</span>
                </div>
              </div>
              {!item.pass && (
                <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">{item.tip}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {aiEnabled && onGenerateAll && (
        <div className="mt-4 pt-3 border-t border-zinc-100">
          <button
            type="button"
            onClick={onGenerateAll}
            disabled={generating}
            className={`w-full px-3 py-2 rounded-lg text-sm font-medium disabled:cursor-not-allowed transition-colors ${
              generating
                ? "btn-processing text-white border border-transparent"
                : "bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-40"
            }`}
          >
            {generating ? "Generating…" : "Generate All"}
          </button>
          {generating && currentStep && (
            <div className="mt-3 space-y-1.5">
              <div className="h-1 rounded-full overflow-hidden bg-zinc-100">
                <div className="h-full btn-processing rounded-full" />
              </div>
              <p className="text-xs text-zinc-500">Running: <span className="font-medium text-zinc-700">{currentStep}</span></p>
            </div>
          )}
          {summary && !generating && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">What changed</p>
              {summary.map((item, i) => (
                <div key={i} className="flex items-baseline gap-2 text-xs">
                  <span className={`shrink-0 font-bold ${item.applied ? "text-green-500" : "text-zinc-300"}`}>
                    {item.applied ? "✓" : "→"}
                  </span>
                  <span className="font-medium text-zinc-700">{item.step}</span>
                  {item.detail && <span className="text-zinc-400 truncate">{item.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Featured image alt text input ─────────────────────────────────────────────

function FeaturedAltInput({ mediaId, initialAlt, onSaved }: {
  mediaId: number;
  initialAlt: string;
  onSaved: (alt: string) => void;
}) {
  const [value, setValue] = useState(initialAlt);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (value === initialAlt) return;
    setSaving(true);
    const result = await updateMediaAltText(mediaId, value);
    setSaving(false);
    if (result.ok) {
      onSaved(value);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="mt-2">
      <label htmlFor="featured-image-alt-input" className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
        Alt text
      </label>
      <div className="flex gap-1.5">
        <input
          id="featured-image-alt-input"
          type="text"
          value={value}
          onChange={e => { setValue(e.target.value); setSaved(false); }}
          onBlur={save}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
          placeholder="Describe the image…"
          className="flex-1 border border-zinc-200 rounded px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400 bg-white"
        />
        {saved && (
          <span className="text-xs text-green-600 font-medium self-center shrink-0">Saved</span>
        )}
        {saving && (
          <span className="text-xs text-zinc-400 self-center shrink-0">Saving…</span>
        )}
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  "internal-links": "Internal Link Suggestions",
  "topic-report": "Topic Focus Report",
};

const ACTION_INSTRUCTIONS: Record<string, string> = {
  "internal-links": "Paste each link into your content where the anchor text fits naturally. Internal links improve SEO and keep readers engaged longer.",
  "topic-report": "A low score means your content is too broad or unfocused. Narrow the angle, add more depth on the main topic, or break it into multiple posts.",
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

// Defined outside PostForm so React preserves component identity across re-renders.
// Defining stateful components inside a parent function causes unmount/remount on every
// parent re-render, which destroys controlled input state and loses focus.

function RunBtn({ tool, label, moreAiPending, moreAiResults, agentRunning, runMoreAi }: {
  tool: string;
  label: string;
  moreAiPending: string | null;
  moreAiResults: Record<string, string>;
  agentRunning: boolean;
  runMoreAi: (tool: string) => void;
}) {
  const isSpinning = moreAiPending === tool;
  const done = !!moreAiResults[tool];
  return (
    <button
      type="button"
      disabled={!!moreAiPending || agentRunning}
      onClick={() => runMoreAi(tool)}
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border transition-all disabled:cursor-not-allowed
        ${isSpinning
          ? "btn-processing border-transparent text-white cursor-wait"
          : done
            ? "bg-violet-50 border-violet-200 text-violet-500"
            : "bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100 hover:border-violet-300 disabled:opacity-40"
        }`}
    >
      {done ? (
        <span className="w-2.5 h-2.5 flex items-center justify-center shrink-0">✓</span>
      ) : (
        <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )}
      {isSpinning ? "Working…" : label}
    </button>
  );
}

function AiDocumentActions({ handleAssist, pendingAction, assistFeedback, setAssistFeedback,
  handleToneCheck, handleReadingLevel, moreAiPending, moreAiResults, agentRunning, runMoreAi }: {
  handleAssist: (instruction: string) => void;
  pendingAction: string | null;
  assistFeedback: string | null;
  setAssistFeedback: (v: string | null) => void;
  handleToneCheck: () => void;
  handleReadingLevel: () => void;
  moreAiPending: string | null;
  moreAiResults: Record<string, string>;
  agentRunning: boolean;
  runMoreAi: (tool: string) => void;
}) {
  const [instruction, setInstruction] = useState("");

  function submit() {
    const val = instruction.trim();
    if (!val) return;
    handleAssist(val);
    setInstruction("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={instruction}
          onChange={e => { setInstruction(e.target.value); if (assistFeedback) setAssistFeedback(null); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          disabled={!!pendingAction}
          placeholder="Ask the AI — rewrite, suggest excerpt, check tone, simplify…"
          className="flex-1 min-w-0 border border-zinc-200 rounded-full px-3 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 placeholder:text-zinc-400 disabled:opacity-50"
        />
        <AiBtn
          label="Ask"
          pending={!!pendingAction}
          activeKey={pendingAction}
          myKey="assist"
          onClick={submit}
        />
      </div>
      {assistFeedback && (
        <div className="flex items-start gap-2 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-xs text-zinc-500">
          <span className="shrink-0 mt-px">ℹ</span>
          <span className="flex-1">{assistFeedback}</span>
          <button type="button" onClick={() => setAssistFeedback(null)} className="shrink-0 text-zinc-400 hover:text-zinc-600">✕</button>
        </div>
      )}
      <div className="flex items-center gap-1 flex-wrap">
        <AiBtn label="Tone check"    pending={!!pendingAction} activeKey={pendingAction} myKey="tone-check"    onClick={handleToneCheck} />
        <AiBtn label="Reading level" pending={!!pendingAction} activeKey={pendingAction} myKey="reading-level" onClick={handleReadingLevel} />
        <span className="w-px h-3 bg-zinc-200 mx-0.5 shrink-0" />
        <RunBtn tool="topic-report"   label="Topic focus"     moreAiPending={moreAiPending} moreAiResults={moreAiResults} agentRunning={agentRunning} runMoreAi={runMoreAi} />
        <RunBtn tool="internal-links" label="Internal links"  moreAiPending={moreAiPending} moreAiResults={moreAiResults} agentRunning={agentRunning} runMoreAi={runMoreAi} />
      </div>
    </div>
  );
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
  initialSeoTitle,
  initialSeoMetaDescription,
  initialRobotsNoindex,
  initialRobotsNofollow,
  initialCanonicalUrl,
  initialOgImageUrl,
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
  const [seoTitle, setSeoTitle] = useState(initialSeoTitle ?? "");
  const [seoMetaDescription, setSeoMetaDescription] = useState(initialSeoMetaDescription ?? "");
  const [robotsNoindex, setRobotsNoindex] = useState(initialRobotsNoindex ?? false);
  const [robotsNofollow, setRobotsNofollow] = useState(initialRobotsNofollow ?? false);
  const [canonicalUrl, setCanonicalUrl] = useState(initialCanonicalUrl ?? "");
  const [ogImageUrl, setOgImageUrl] = useState(initialOgImageUrl ?? "");
  const [contentForAudit, setContentForAudit] = useState(initialContent ?? "");
  const intentRef = useRef<HTMLInputElement>(null);

  function handleMediaUploaded(item: MediaItem) {
    setSharedMedia(prev => [item, ...prev]);
    setSessionMedia(prev => [item, ...prev]);
  }

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const aeoRef = useRef<AeoMetadataEditorHandle>(null);

  const [isDirty, setIsDirty] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // localStorage draft key for new posts (no postId yet)
  const LS_DRAFT_KEY = "pugmill:draft:new-post";

  // On mount for new posts: check localStorage for a recoverable draft
  const [localDraftAvailable, setLocalDraftAvailable] = useState(false);
  useEffect(() => {
    if (postId) return; // edit mode — no local draft needed
    try {
      const raw = localStorage.getItem(LS_DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const age = Date.now() - (parsed.savedAt ?? 0);
      if (age < 24 * 60 * 60 * 1000 && (parsed.title || parsed.content)) {
        setLocalDraftAvailable(true);
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // For new posts: save to localStorage 3s after last change
  const localSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (postId || !isDirty) return;
    if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current);
    localSaveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(LS_DRAFT_KEY, JSON.stringify({
          title,
          slug,
          content: editorRef.current?.getContent() ?? "",
          excerpt,
          savedAt: Date.now(),
        }));
        setAutosaveStatus("saved");
        setTimeout(() => setAutosaveStatus("idle"), 3000);
      } catch { /* quota exceeded or private mode */ }
    }, 3_000);
    return () => { if (localSaveTimerRef.current) clearTimeout(localSaveTimerRef.current); };
  }, [isDirty, title, slug, excerpt, postId]);

  // Debounced server autosave — fires 3s after last change, edit mode only.
  useEffect(() => {
    if (!isDirty || !postId) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      setAutosaveStatus("saving");
      const result = await autosavePost(postId, {
        title,
        slug,
        content: editorRef.current?.getContent() ?? "",
        excerpt: excerpt || undefined,
        seoTitle: seoTitle || undefined,
        seoMetaDescription: seoMetaDescription || undefined,
        aeoMetadata: aeoMeta,
        canonicalUrl: canonicalUrl || undefined,
        ogImageUrl: ogImageUrl || undefined,
      });
      if (result.ok) {
        setAutosaveStatus("saved");
        setIsDirty(false);
        setTimeout(() => setAutosaveStatus("idle"), 3000);
      } else {
        setAutosaveStatus("error");
      }
    }, 3_000);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
  }, [isDirty, title, slug, excerpt, seoTitle, seoMetaDescription, aeoMeta, canonicalUrl, ogImageUrl, postId]);

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
  const {
    pendingAction,
    aiError,
    aiUsage,
    titleSuggestions,
    setTitleSuggestions,
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
    handleSuggestTitles,
    handleGenerateSlug,
    handleSuggestExcerpt,
    handleSuggestSeo,
    handleRewrite,
    handleAssist,
    handleReadingLevel,
    assistFeedback,
    setAssistFeedback,
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
    excerptSuggestion,
    setExcerptSuggestion,
    swapPassageState,
    setSwapPassageState,
    handleSwapPassage,
    applySwapPassage,
  } = useAiTools({
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
  });

  function renderToolResult(action: string, result: string) {
    let content: React.ReactNode;
    try {
      if (action === "internal-links") {
        const suggestions = parseJson<Array<{ slug: string; path?: string; title: string; anchorText: string; context: string }>>(result);
        content = suggestions.length === 0
          ? <p className="text-sm text-zinc-500">No strong internal linking opportunities found.</p>
          : (
            <ul className="divide-y divide-zinc-100">
              {suggestions.map((s, i) => {
                const linkPath = s.path ?? `/post/${s.slug}`;
                const md = `[${s.anchorText}](${linkPath})`;
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
                          const ok = tryInsertInternalLink(s.anchorText, linkPath, s.context);
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
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleRefineFocus}
                  disabled={!!pendingAction}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-all disabled:cursor-not-allowed ${
                    pendingAction === "refine-focus"
                      ? "btn-processing border-transparent text-white"
                      : "bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100 hover:border-violet-300 disabled:opacity-40"
                  }`}
                >
                  {pendingAction === "refine-focus" ? "Analyzing…" : "Refine Focus"}
                </button>
              </div>
            )}
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

  function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
      <p className="text-xs font-semibold tracking-widest text-zinc-700 uppercase mb-3">{children}</p>
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
        {autosaveStatus !== "idle" && (
          <p className={`text-xs shrink-0 hidden sm:block ${
            autosaveStatus === "saving" ? "text-zinc-400" :
            autosaveStatus === "saved"  ? "text-green-500" :
                                          "text-red-400"
          }`}>
            {autosaveStatus === "saving" ? "Saving…" : autosaveStatus === "saved" ? "Saved" : "Autosave failed"}
          </p>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/admin/posts"
            className="px-3 py-1.5 rounded-lg text-sm text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden px-3 py-1.5 rounded-lg border border-zinc-200 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
            title="Open settings"
          >
            Settings
          </button>
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
            className="px-3 py-1.5 rounded-full bg-[var(--ds-blue-1000)] text-white text-sm font-medium hover:bg-[var(--ds-blue-900)] transition-colors"
          >
            Publish
          </button>
        </div>
      </div>

      {/* Spacer — matches fixed bar height so content doesn't hide underneath it */}
      <div className="h-12 shrink-0" />

      {localDraftAvailable && (
        <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <span className="flex-1">A locally saved draft was found. Restore it?</span>
          <button
            type="button"
            className="font-medium underline hover:text-amber-900"
            onClick={() => {
              try {
                const raw = localStorage.getItem(LS_DRAFT_KEY);
                if (!raw) return;
                const parsed = JSON.parse(raw) as { title?: string; slug?: string; content?: string; excerpt?: string };
                if (parsed.title) setTitle(parsed.title);
                if (parsed.slug) { setSlug(parsed.slug); setSlugManuallySet(true); }
                if (parsed.content) editorRef.current?.setContent(parsed.content);
                if (parsed.excerpt) setExcerpt(parsed.excerpt);
                setIsDirty(true);
              } catch { /* ignore */ }
              setLocalDraftAvailable(false);
            }}
          >
            Restore
          </button>
          <button
            type="button"
            className="text-amber-500 hover:text-amber-700"
            onClick={() => {
              localStorage.removeItem(LS_DRAFT_KEY);
              setLocalDraftAvailable(false);
            }}
          >
            ✕
          </button>
        </div>
      )}

      {aiError && (
        <p className="text-xs text-red-500 mb-4">{aiError}</p>
      )}

      <form id="post-form" action={action} onSubmit={() => setIsDirty(false)} className="space-y-4">
        <input ref={intentRef} type="hidden" name="intent" defaultValue="publish" />

        {/* Two-column layout: left (type + title + content) | right (AEO health + images) */}
        <div className="flex flex-col lg:flex-row lg:items-start gap-4">

        {/* Left column */}
        <div className="flex-1 min-w-0 lg:flex-[4] space-y-4">

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
                <>
                  <input
                    type="datetime-local"
                    name="publishAt"
                    value={publishAt}
                    onChange={e => setPublishAt(e.target.value)}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-1.5 text-sm bg-white text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                  />

                </>
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
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-zinc-500 mb-2">Suggested — click to use:</p>
              {([["curiosity", "Curiosity"], ["utility", "Utility"]] as const).map(([key, label]) => (
                <div key={key} className="flex items-start gap-2">
                  <span className="text-xs font-semibold text-violet-500 w-16 shrink-0 pt-1.5">{label}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const t = titleSuggestions[key];
                      setTitle(t);
                      setTitleSuggestions(null);
                      if (!slugManuallySet) setSlug(toSlug(t));
                    }}
                    className="flex-1 text-left text-sm text-zinc-700 hover:text-zinc-900 px-2 py-1 rounded hover:bg-zinc-100 transition-colors"
                  >{titleSuggestions[key]}</button>
                </div>
              ))}
              <button type="button" onClick={() => setTitleSuggestions(null)} className="text-xs text-zinc-500 hover:text-zinc-600 px-2 pt-1">Dismiss</button>
            </div>
          )}
        </div>

        {/* Content editor */}
        <div id="content-editor-card" className="bg-white border border-zinc-200 rounded-lg">
          {/* Sticky toolbar — sticks below the fixed action bar (top-14 = 56px) */}
          <div data-editor-toolbar className="sticky top-14 z-20 px-6 pt-5 pb-3 border-b border-zinc-100 rounded-t-lg" style={{ background: "#f5f0ff" }}>
            <SectionLabel>Content</SectionLabel>
            {aiEnabled && <AiDocumentActions
              handleAssist={handleAssist}
              pendingAction={pendingAction}
              assistFeedback={assistFeedback}
              setAssistFeedback={setAssistFeedback}
              handleToneCheck={handleToneCheck}
              handleReadingLevel={handleReadingLevel}
              moreAiPending={moreAiPending}
              moreAiResults={moreAiResults}
              agentRunning={agentRunning}
              runMoreAi={runMoreAi}
            />}
            {/* Toolbar portal target — MarkdownEditor portals its toolbar here */}
            <div id="md-toolbar-portal" />
          </div>

          {/* Scrolling body */}
          <div className="px-6 pt-4 pb-6">
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

              {readingLevel && (
                <div className="mb-4 border border-zinc-200 rounded-lg p-4 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold tracking-widest text-zinc-700 uppercase">Reading Level</p>
                    <button type="button" onClick={() => setReadingLevel(null)} className="text-xs text-zinc-400 hover:text-zinc-600">✕</button>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-zinc-900">{readingLevel.gradeLevel}</span>
                    <span className="text-sm text-zinc-500">/ Grade</span>
                    <span className="ml-auto text-xs font-semibold bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded-full">{readingLevel.level}</span>
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">{readingLevel.note}</p>
                  {readingLevel.fit && (
                    <p className="text-xs text-zinc-400 italic">{readingLevel.fit}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => { setReadingLevel(null); handleRewrite("simplify to plain language, shorter sentences, no jargon"); }}
                    className="text-xs text-violet-600 hover:text-violet-800 font-medium underline"
                  >Simplify draft →</button>
                </div>
              )}

              {/* Topic Focus result — above editor, same slot as Tone Suggestions */}
              {aiEnabled && (moreAiResults["topic-report"] || refineFocusResult !== null) && (
                <div className="mb-4 space-y-3">
                  {moreAiResults["topic-report"] && renderToolResult("topic-report", moreAiResults["topic-report"])}
                  {refineFocusResult !== null && (
                    <div>
                      {refineFocusResult.length === 0 && (
                        <p className="text-xs text-green-600 font-medium">Post is well-focused — no issues found.</p>
                      )}
                      {refineFocusResult.length > 0 && (
                        <div className="space-y-2">
                          {refineFocusResult.map((issue, i) => {
                            if (dismissedIssues.has(i)) return null;
                            return (
                              <div key={i} className="p-3 bg-amber-50 border-l-2 border-amber-400 rounded-r">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-xs font-semibold text-zinc-800">{issue.label}</p>
                                  <button
                                    type="button"
                                    onClick={() => setDismissedIssues(prev => new Set([...prev, i]))}
                                    className="text-zinc-300 hover:text-zinc-500 transition-colors shrink-0 mt-0.5"
                                    title="Mark as done"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  </button>
                                </div>
                                {issue.passage && (
                                  <div className="flex items-start gap-2 mt-1">
                                    <p className="text-xs text-zinc-500 italic flex-1">&ldquo;{issue.passage}&rdquo;</p>
                                    <div className="flex gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const found = editorRef.current?.scrollToText(issue.passage!);
                                          if (!found) {
                                            navigator.clipboard.writeText(issue.passage!);
                                            return;
                                          }
                                          const card = document.getElementById("content-editor-card");
                                          if (card) {
                                            const y = card.getBoundingClientRect().top + window.scrollY - 72;
                                            window.scrollTo({ top: y, behavior: "smooth" });
                                          }
                                        }}
                                        className="text-xs text-violet-500 hover:text-violet-700 font-medium transition-colors"
                                        title="Find in editor"
                                      >
                                        Find
                                      </button>
                                      {aiEnabled && (
                                        <button
                                          type="button"
                                          disabled={swapPassageState?.issueIndex === i && swapPassageState.pending}
                                          onClick={() => handleSwapPassage(issue, i)}
                                          className="text-xs text-amber-600 hover:text-amber-800 font-medium transition-colors disabled:opacity-50"
                                          title="Rewrite this passage with AI"
                                        >
                                          {swapPassageState?.issueIndex === i && swapPassageState.pending ? "…" : "Swap"}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )}
                                {swapPassageState?.issueIndex === i && !swapPassageState.pending && swapPassageState.result && (
                                  <div className="mt-2 p-2 bg-white border border-amber-200 rounded text-xs">
                                    <p className="text-zinc-700 mb-2">{swapPassageState.result}</p>
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={() => applySwapPassage(issue.passage!, swapPassageState.result!)}
                                        className="px-2 py-0.5 bg-amber-500 text-white rounded font-medium hover:bg-amber-600 transition-colors"
                                      >Apply</button>
                                      <button
                                        type="button"
                                        onClick={() => setSwapPassageState(null)}
                                        className="text-zinc-400 hover:text-zinc-600 transition-colors"
                                      >Dismiss</button>
                                    </div>
                                  </div>
                                )}
                                <p className="text-xs text-zinc-700 mt-1.5 font-medium">Fix: {issue.recommendation}</p>
                              </div>
                            );
                          })}
                          {refineFocusResult.every((_, i) => dismissedIssues.has(i)) && (
                            <p className="text-xs text-green-600 font-medium">All issues addressed.</p>
                          )}
                          <button
                            type="button"
                            onClick={() => { setRefineFocusResult(null); setDismissedIssues(new Set()); }}
                            className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors"
                          >
                            Dismiss all
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Internal Links result — above editor, same slot as Tone Suggestions */}
              {aiEnabled && moreAiResults["internal-links"] && (
                <div className="mb-4">
                  {renderToolResult("internal-links", moreAiResults["internal-links"])}
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
                onContentChange={setContentForAudit}
              />
          </div>{/* end scrolling body */}
        </div>{/* end content editor */}

        {/* Images — inside left column */}
        <div className="bg-white border border-zinc-200 rounded-lg p-4 flex flex-col gap-3">
          {featuredId !== null && (
            <>
              <input type="hidden" name="featuredImage" value={featuredId} />
              {(() => {
                const featuredUrl = sharedMedia.find(m => m.id === featuredId)?.url ?? initialFeaturedImageUrl;
                const featuredItem = sharedMedia.find(m => m.id === featuredId);
                return featuredUrl ? (
                  <div>
                    <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">Featured image</p>
                    <div className="relative rounded-lg overflow-hidden bg-zinc-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={featuredUrl} alt="Featured" className="w-full object-cover max-h-56" />
                      <button
                        type="button"
                        onClick={() => setFeaturedId(null)}
                        className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full w-6 h-6 flex items-center justify-center transition-colors"
                        title="Remove featured image"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <FeaturedAltInput
                      mediaId={featuredId!}
                      initialAlt={featuredItem?.altText ?? ""}
                      onSaved={(alt) => setSharedMedia(prev => prev.map(m => m.id === featuredId ? { ...m, altText: alt } : m))}
                    />
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

        {/* Excerpt — inside left column */}
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
          {excerptSuggestion && (
            <div className="mt-3 p-3 bg-violet-50 border border-violet-200 rounded-lg">
              <p className="text-xs text-zinc-500 mb-1.5">AI suggestion — review before applying:</p>
              <p className="text-sm text-zinc-800 mb-3">{excerptSuggestion}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setExcerpt(excerptSuggestion); setExcerptSuggestion(null); }}
                  className="px-3 py-1 text-xs font-medium bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors"
                >Apply</button>
                <button
                  type="button"
                  onClick={() => setExcerptSuggestion(null)}
                  className="px-3 py-1 text-xs text-zinc-500 hover:text-zinc-700 transition-colors"
                >Dismiss</button>
              </div>
            </div>
          )}
        </div>

        {/* Bottom actions — inside left column */}
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
            className="px-4 py-2 rounded-full bg-[var(--ds-blue-1000)] text-white text-sm font-medium hover:bg-[var(--ds-blue-900)] transition-colors"
          >
            Publish
          </button>
        </div>
        </div>{/* end left column */}

        {/* Right sidebar — sticky column on desktop, overlay drawer on mobile */}
        <div className={`shrink-0 lg:flex-[2] lg:sticky lg:top-[52px] lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto${sidebarOpen ? " fixed inset-0 z-30" : " hidden lg:block"}`}>
          {sidebarOpen && (
            <div className="fixed inset-0 bg-black/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
          )}
          <div className={`${sidebarOpen ? "fixed right-0 top-0 bottom-0 w-80 overflow-y-auto" : ""} lg:static lg:w-auto bg-white lg:bg-transparent space-y-4 p-4 lg:p-0`}>
            {sidebarOpen && (
              <div className="flex items-center justify-between mb-2 lg:hidden">
                <span className="text-sm font-medium text-zinc-700">Settings</span>
                <button type="button" onClick={() => setSidebarOpen(false)} className="text-zinc-400 hover:text-zinc-700 transition-colors">✕</button>
              </div>
            )}

            <AeoHealthPanel
              aeo={aeoMeta}
              content={contentForAudit}
              featuredAlt={sharedMedia.find(m => m.id === featuredId)?.altText}
              aiEnabled={aiEnabled}
              onGenerateAll={handleGenerateAll}
              generating={agentRunning}
              currentStep={agentCurrentStep}
              summary={agentSummary}
            />

            {/* Categories — placed under AEO Health for prominence */}
            <div className="bg-white border border-zinc-200 rounded-lg p-6">
              <TaxonomyPicker
                label="Categories"
                fieldName="categories"
                items={allCategories}
                selectedIds={initialCategoryIds ? new Set(initialCategoryIds) : undefined}
                onCreate={createCategoryInline}
                onAiSuggest={aiEnabled ? handleSuggestCategories : undefined}
                aiPending={pendingAction === "categories"}
                suggestions={catSuggestions ?? undefined}
                onSuggestDismiss={() => setCatSuggestions(null)}
              />
            </div>

            {/* Tags — placed under AEO Health for prominence */}
            <div className="bg-white border border-zinc-200 rounded-lg p-6">
              <TaxonomyPicker
                label="Tags"
                fieldName="tags"
                items={allTags}
                selectedIds={initialTagIds ? new Set(initialTagIds) : undefined}
                onCreate={createTagInline}
                onAiSuggest={aiEnabled ? handleSuggestTags : undefined}
                aiPending={pendingAction === "tags"}
                suggestions={tagSuggestions ?? undefined}
                onSuggestDismiss={() => setTagSuggestions(null)}
              />
            </div>

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

            {/* AEO */}
            <div className="bg-white border border-zinc-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <SectionLabel>AEO</SectionLabel>
                  {(() => {
                    const aeoComplete =
                      !!aeoMeta.summary?.trim() &&
                      (aeoMeta.questions?.filter(q => q.q && q.a).length ?? 0) >= 1 &&
                      (aeoMeta.entities?.filter(e => e.name).length ?? 0) >= 1 &&
                      (aeoMeta.keywords?.filter(k => k.trim()).length ?? 0) >= 5;
                    return aeoComplete ? (
                      <svg className="w-3.5 h-3.5 text-green-500 -mt-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : null;
                  })()}
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

            {/* SEO */}
            <div className="bg-white border border-zinc-200 rounded-lg p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SectionLabel>SEO</SectionLabel>
                  {seoTitle.trim() && seoMetaDescription.trim() && (
                    <svg className="w-3.5 h-3.5 text-green-500 -mt-3 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                {aiEnabled && (
                  <AiBtn label="Generate SEO" pending={!!pendingAction} activeKey={pendingAction} myKey="seo" onClick={handleSuggestSeo} />
                )}
              </div>
              <div className="mt-3 space-y-4">
                <SerpPreview
                  seoTitle={seoTitle}
                  seoMetaDescription={seoMetaDescription}
                  postTitle={title}
                  slug={slug}
                />
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-zinc-500">SEO Title</label>
                    <span className={`text-xs ${seoTitle.length > 60 ? "text-red-500" : "text-zinc-400"}`}>
                      {seoTitle.length}/60
                    </span>
                  </div>
                  <input
                    name="seoTitle"
                    value={seoTitle}
                    onChange={e => { setSeoTitle(e.target.value); setIsDirty(true); }}
                    maxLength={60}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
                    placeholder="Custom title tag — leave blank to use post title"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-zinc-500">Meta Description</label>
                    <span className={`text-xs ${seoMetaDescription.length > 155 ? "text-red-500" : "text-zinc-400"}`}>
                      {seoMetaDescription.length}/155
                    </span>
                  </div>
                  <textarea
                    name="seoMetaDescription"
                    value={seoMetaDescription}
                    onChange={e => { setSeoMetaDescription(e.target.value); setIsDirty(true); }}
                    maxLength={155}
                    rows={3}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 resize-none"
                    placeholder="Custom meta description — leave blank to use excerpt"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 block mb-1">Canonical URL</label>
                  <input
                    name="canonicalUrl"
                    value={canonicalUrl}
                    onChange={e => { setCanonicalUrl(e.target.value); setIsDirty(true); }}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
                    placeholder="Leave blank to use default permalink"
                  />
                </div>
                {/* Robots meta */}
                <div className="pt-1 space-y-2">
                  <p className="text-xs font-medium text-zinc-500">Robots directives</p>
                  <input type="hidden" name="robotsNoindex" value="0" />
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      name="robotsNoindex"
                      value="1"
                      checked={robotsNoindex}
                      onChange={e => { setRobotsNoindex(e.target.checked); setIsDirty(true); }}
                      className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500"
                    />
                    <span className="text-sm text-zinc-700">noindex — hide from search engines</span>
                  </label>
                  <input type="hidden" name="robotsNofollow" value="0" />
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      name="robotsNofollow"
                      value="1"
                      checked={robotsNofollow}
                      onChange={e => { setRobotsNofollow(e.target.checked); setIsDirty(true); }}
                      className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500"
                    />
                    <span className="text-sm text-zinc-700">nofollow — tell crawlers not to follow links</span>
                  </label>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 block mb-1">OG Image URL</label>
                  <input
                    name="ogImageUrl"
                    value={ogImageUrl}
                    onChange={e => { setOgImageUrl(e.target.value); setIsDirty(true); }}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
                    placeholder="Leave blank to use featured image"
                  />
                </div>
              </div>
            </div>

            {/* Social Post */}
            {aiEnabled && (
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
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                        socialPlatform === p.id && socialPending
                          ? "bg-violet-600 border-violet-600 text-white cursor-wait"
                          : socialPlatform === p.id && !socialPending
                            ? "bg-violet-600 border-violet-600 text-white"
                            : socialPending
                              ? "bg-violet-50 border-violet-200 text-violet-300 cursor-not-allowed"
                              : "bg-violet-50 border-violet-200 text-violet-600 hover:bg-violet-100 hover:border-violet-300"
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
            )}
          </div>
        </div>{/* end right sidebar */}
        </div>{/* end two-column layout */}
      </form>
    </div>
  );
}
