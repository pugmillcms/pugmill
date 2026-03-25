"use client";
import { useEffect, useRef, useState, forwardRef, useImperativeHandle, useCallback } from "react";
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import { uploadMedia } from "@/lib/actions/media";
import type { NodeViewProps } from "@tiptap/react";

export interface MarkdownEditorHandle {
  setContent: (value: string) => void;
  getContent: () => string;
  insertImage: (url: string, alt: string) => void;
  scrollToText: (text: string) => boolean;
}

interface MediaItem { id: number; url: string; fileName: string; }

interface Props {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  onContentChange?: (markdown: string) => void;
  allMedia?: MediaItem[];
  aiEnabled?: boolean;
  postTitle?: string;
  onMediaUploaded?: (item: MediaItem) => void;
}

// ── Deletable image node view ─────────────────────────────────────────────────
// Wraps each image in a block container with a hover-visible delete button so
// users can remove images in the visual editor without switching to Markdown.

function ImageNodeView({ node, deleteNode }: NodeViewProps) {
  return (
    <NodeViewWrapper as="div" className="relative group my-2 inline-block max-w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={node.attrs.src as string}
        alt={(node.attrs.alt as string) ?? ""}
        className="max-w-full rounded"
      />
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); deleteNode(); }}
        className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove image"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </NodeViewWrapper>
  );
}

const DeletableImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});

function normalizeImageBlocks(md: string): string {
  return md
    .replace(/([^\n])\n(!\[[^\]]*\]\([^)]+\))/g, "$1\n\n$2")
    .replace(/(!\[[^\]]*\]\([^)]+\))\n?([^\n])/g, "$1\n\n$2")
    .replace(/\n{3,}/g, "\n\n");
}

function toSeoSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "image";
}

function fileNameToAlt(fileName: string): string {
  return fileName
    .replace(/^\d+-/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  { name, defaultValue = "", placeholder, onContentChange, allMedia = [], aiEnabled = false, postTitle = "", onMediaUploaded },
  ref
) {
  const [mode, setMode] = useState<"visual" | "raw">("visual");
  const [markdown, setMarkdown] = useState(defaultValue);
  const editorIsSource = useRef(false);
  // Keep a stable ref to onContentChange so the Tiptap onUpdate closure never goes stale.
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const contentChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Image picker state
  const [imgPickerOpen, setImgPickerOpen] = useState(false);
  const [library, setLibrary] = useState<MediaItem[]>(allMedia);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);

  // Alt text confirm step
  const [pendingItem, setPendingItem] = useState<MediaItem | null>(null);
  const [pendingAlt, setPendingAlt] = useState("");
  const [altLoading, setAltLoading] = useState(false);
  const altInputRef = useRef<HTMLInputElement>(null);

  // Drag-and-drop visual feedback
  const [isDragOver, setIsDragOver] = useState(false);

  // Stable ref for the drop handler so editorProps closure doesn't go stale
  const onDropFileRef = useRef<(file: File) => void>(() => {});

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      DeletableImage,
      Markdown.configure({ transformPastedText: true, transformCopiedText: true }),
    ],
    content: defaultValue,
    editorProps: {
      attributes: {
        class: "prose prose-slate max-w-none min-h-[320px] px-4 py-3 focus:outline-none text-sm",
      },
      handleDrop(view, event) {
        // Panel-dragged image (from PostImagePanel)
        const panelData = event.dataTransfer?.getData("application/pugmill-image");
        if (panelData) {
          try {
            const { url, alt } = JSON.parse(panelData) as { url: string; alt: string };
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (coords) {
              const imageNode = view.state.schema.nodes.image?.create({ src: url, alt: alt ?? "" });
              if (imageNode) view.dispatch(view.state.tr.insert(coords.pos, imageNode));
            }
          } catch { /* ignore malformed data */ }
          event.preventDefault();
          return true;
        }
        // OS file drop (existing behaviour)
        const file = Array.from(event.dataTransfer?.files ?? []).find(f =>
          f.type.startsWith("image/")
        );
        if (!file) return false;
        event.preventDefault();
        onDropFileRef.current(file);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      editorIsSource.current = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (editor.storage as any).markdown.getMarkdown();
      const md = normalizeImageBlocks(raw);
      setMarkdown(md);
      // Debounce the parent callback — fires 300ms after the last keystroke to
      // avoid triggering a full PostForm re-render on every keypress.
      if (contentChangeTimer.current) clearTimeout(contentChangeTimer.current);
      contentChangeTimer.current = setTimeout(() => {
        onContentChangeRef.current?.(md);
      }, 300);
    },
  });

  useImperativeHandle(ref, () => ({
    setContent(value: string) {
      setMarkdown(value);
      editor?.commands.setContent(value);
    },
    getContent() {
      return markdown;
    },
    insertImage(url: string, alt: string) {
      if (!editor) return;
      editor.chain().focus().setImage({ src: url, alt }).run();
    },
    scrollToText(text: string): boolean {
      if (!editor || !text) return false;
      let found = false;
      editor.state.doc.descendants((node, pos) => {
        if (found || !node.isText || !node.text) return;
        const idx = node.text.indexOf(text);
        if (idx === -1) return;
        const from = pos + idx;
        const to = from + text.length;
        editor.chain().focus().setTextSelection({ from, to }).run();
        found = true;
      });
      if (found) {
        // Scroll the page so the editor is visible at the top of the viewport
        editor.view.dom.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return found;
    },
  }));

  useEffect(() => {
    if (editorIsSource.current) {
      editorIsSource.current = false;
      return;
    }
    if (editor && mode === "visual") {
      editor.commands.setContent(markdown);
    }
  }, [markdown, editor, mode]);

  const handleRawChange = (value: string) => {
    setMarkdown(value);
    onContentChange?.(value);
    editor?.commands.setContent(value);
  };

  // ── Alt text helpers ──────────────────────────────────────────────────────

  async function fetchAiAlt(url: string): Promise<string | null> {
    try {
      const res = await fetch("/api/ai/alt-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageUrl: url, postTitle }),
      });
      const data = await res.json() as { result?: string | null; error?: string };
      return data.result ?? null;
    } catch {
      return null;
    }
  }

  function fallbackAlt(fileName: string): string {
    const name = fileNameToAlt(fileName);
    return postTitle ? `${name} — ${postTitle}` : name;
  }

  async function openAltStep(item: MediaItem) {
    setPendingItem(item);
    setPendingAlt(""); // clear while loading

    if (aiEnabled) {
      setAltLoading(true);
      const aiAlt = await fetchAiAlt(item.url);
      setAltLoading(false);
      setPendingAlt(aiAlt ?? fallbackAlt(item.fileName));
    } else {
      setPendingAlt(fallbackAlt(item.fileName));
    }

    setImgPickerOpen(true);
    setTimeout(() => altInputRef.current?.focus(), 0);
  }

  function confirmInsert() {
    if (!pendingItem) return;
    editor?.chain().focus().setImage({ src: pendingItem.url, alt: pendingAlt.trim() }).run();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (editor?.storage as any)?.markdown?.getMarkdown() ?? "";
    const md = normalizeImageBlocks(raw);
    setMarkdown(md);
    onContentChange?.(md);
    setPendingItem(null);
    setPendingAlt("");
    setImgPickerOpen(false);
  }

  function cancelAlt() {
    setPendingItem(null);
    setPendingAlt("");
    setAltLoading(false);
  }

  // ── Upload helpers ────────────────────────────────────────────────────────

  async function uploadFile(file: File): Promise<MediaItem | null> {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    const baseName = postTitle ? `${toSeoSlug(postTitle)}${ext}` : file.name;
    const renamedFile = new File([file], baseName, { type: file.type });
    const fd = new FormData();
    fd.append("file", renamedFile);
    const result = await uploadMedia(fd);
    if ("error" in result && result.error) {
      setUploadError(result.error);
      return null;
    }
    if (result.id && result.url) {
      const item: MediaItem = { id: result.id, url: result.url, fileName: file.name };
      setLibrary(prev => [item, ...prev]);
      onMediaUploaded?.(item);
      return item;
    }
    return null;
  }

  async function handlePickerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    const item = await uploadFile(file);
    setUploading(false);
    if (item) openAltStep(item);
    if (imgFileRef.current) imgFileRef.current.value = "";
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────

  const handleDroppedFile = useCallback(async (file: File) => {
    setIsDragOver(false);
    setUploading(true);
    setUploadError(null);
    const item = await uploadFile(file);
    setUploading(false);
    if (item) openAltStep(item);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEnabled, postTitle]);

  // Keep the ref current so the Tiptap drop handler always calls the latest version
  onDropFileRef.current = handleDroppedFile;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-1">
      <input type="hidden" name={name} value={markdown} />

      {/* Toolbar */}
      <div className="flex items-center justify-between border border-b-0 border-zinc-200 rounded-t-md bg-zinc-200 px-3 py-1.5">
        <div className="flex gap-1 flex-wrap">
          {editor && mode === "visual" && (
            <>
              <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Bold">
                <strong>B</strong>
              </ToolbarButton>
              <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Italic">
                <em>I</em>
              </ToolbarButton>
              <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")} title="Inline code">
                <code className="text-xs">{"`"}</code>
              </ToolbarButton>
              <div className="w-px bg-zinc-200 mx-1" />
              <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Heading 2">H2</ToolbarButton>
              <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Heading 3">H3</ToolbarButton>
              <div className="w-px bg-zinc-200 mx-1" />
              <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Bullet list">•—</ToolbarButton>
              <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} title="Ordered list">1.</ToolbarButton>
              <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")} title="Blockquote">"</ToolbarButton>
              <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive("codeBlock")} title="Code block">{"</>"}</ToolbarButton>
              <div className="w-px bg-zinc-200 mx-1" />
              <ToolbarButton onClick={() => setImgPickerOpen(true)} active={false} title="Insert image">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </ToolbarButton>
            </>
          )}
        </div>

        <div className="flex rounded border overflow-hidden text-xs">
          <button type="button" onClick={() => setMode("visual")} className={`px-2.5 py-1 ${mode === "visual" ? "bg-[var(--ds-blue-1000)] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>Visual</button>
          <button type="button" onClick={() => setMode("raw")} className={`px-2.5 py-1 ${mode === "raw" ? "bg-[var(--ds-blue-1000)] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>Markdown</button>
        </div>
      </div>

      {/* Editor area — drag-and-drop target */}
      <div
        className={`border border-zinc-200 rounded-b-md bg-white transition-colors ${isDragOver ? "border-blue-400 bg-blue-50/40 ring-2 ring-blue-200" : ""}`}
        onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
      >
        {mode === "visual" ? (
          <div className="relative">
            <EditorContent editor={editor} />
            {isDragOver && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-sm font-medium text-blue-500 bg-white/90 px-4 py-2 rounded-lg shadow border border-blue-200">
                  Drop image to insert
                </span>
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                <svg className="w-6 h-6 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              </div>
            )}
          </div>
        ) : (
          <textarea
            value={markdown}
            onChange={e => handleRawChange(e.target.value)}
            placeholder={placeholder ?? "Write in Markdown..."}
            rows={16}
            className="w-full px-4 py-3 text-sm font-mono resize-y focus:outline-none rounded-b-md"
          />
        )}
      </div>

      <p className="text-xs text-slate-400">
        Content is stored as Markdown.{mode === "visual" && " Drop an image anywhere in the editor to insert it."}
      </p>

      {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}

      <input ref={imgFileRef} type="file" accept="image/*" className="hidden" onChange={handlePickerUpload} />

      {/* Image picker modal */}
      {imgPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setImgPickerOpen(false); cancelAlt(); }}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="text-sm font-semibold text-slate-800">
                {pendingItem ? "Add alt text" : "Insert Image"}
              </h3>
              <button type="button" onClick={() => { setImgPickerOpen(false); cancelAlt(); }} className="text-slate-400 hover:text-slate-700 text-sm">✕</button>
            </div>

            {pendingItem ? (
              <div className="flex-1 p-5 space-y-4">
                <div className="flex gap-4 items-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pendingItem.url} alt="" className="w-24 h-24 object-cover rounded-lg border border-slate-200 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="block text-sm font-medium text-slate-700">Alt text</label>
                      {aiEnabled && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${altLoading ? "bg-blue-50 text-blue-400 animate-pulse" : "bg-blue-50 text-blue-600"}`}>
                          {altLoading ? "AI writing…" : "AI"}
                        </span>
                      )}
                    </div>
                    <input
                      ref={altInputRef}
                      type="text"
                      value={pendingAlt}
                      onChange={e => setPendingAlt(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirmInsert(); } if (e.key === "Escape") cancelAlt(); }}
                      placeholder={altLoading ? "Generating…" : "Describe the image…"}
                      disabled={altLoading}
                      className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    <p className="text-xs text-slate-400">Describes the image for screen readers and SEO.</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4">
                {library.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No images in library yet. Upload one below.</p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {library.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => openAltStep(item)}
                        className="relative aspect-square rounded-lg overflow-hidden border-2 border-slate-200 hover:border-blue-400 transition"
                        title={item.fileName}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.url} alt={item.fileName} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="border-t px-5 py-3 flex items-center gap-3">
              {pendingItem ? (
                <>
                  <button
                    type="button"
                    onClick={confirmInsert}
                    disabled={altLoading}
                    className="text-xs px-4 py-2 rounded bg-[var(--ds-blue-1000)] text-white hover:bg-[var(--ds-blue-900)] disabled:opacity-40 transition"
                  >
                    Insert image
                  </button>
                  <button type="button" onClick={cancelAlt} className="text-xs text-slate-500 hover:text-slate-700">
                    ← Back
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => imgFileRef.current?.click()}
                    disabled={uploading}
                    className="text-xs px-4 py-2 rounded bg-[var(--ds-blue-1000)] text-white hover:bg-[var(--ds-blue-900)] disabled:opacity-40 transition"
                  >
                    {uploading ? "Uploading…" : "Upload new image"}
                  </button>
                  <button type="button" onClick={() => setImgPickerOpen(false)} className="text-xs text-slate-500 hover:text-slate-700">
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default MarkdownEditor;

function ToolbarButton({ children, onClick, active, title }: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-sm font-medium transition ${active ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:bg-slate-100"}`}
    >
      {children}
    </button>
  );
}
