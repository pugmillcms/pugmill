"use client";
import { useState, useRef } from "react";
import { uploadMedia } from "@/lib/actions/media";

interface MediaItem { id: number; url: string; fileName: string; }

interface Props {
  mode: "create" | "edit";
  sessionMedia: MediaItem[];
  associatedMedia: MediaItem[];
  allMedia: MediaItem[];
  featuredId: number | null;
  onFeaturedChange: (id: number | null) => void;
  onInsert: (url: string, alt: string) => void;
  onUpload: (item: MediaItem) => void;
  postTitle: string;
}

const PAGE_SIZE = 20;

function fileNameToAlt(fileName: string): string {
  return fileName
    .replace(/^\d+-/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function toSeoSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "image";
}

export default function PostImagePanel({
  mode, sessionMedia, associatedMedia, allMedia,
  featuredId, onFeaturedChange, onInsert, onUpload, postTitle,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [moreCount, setMoreCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sessionIds = new Set(sessionMedia.map(m => m.id));
  const assocNotInSession = associatedMedia.filter(m => !sessionIds.has(m.id));
  const shownIds = new Set([...sessionIds, ...assocNotInSession.map(m => m.id)]);
  const morePool = allMedia.filter(m => !shownIds.has(m.id));
  const shownMore = morePool.slice(0, moreCount);
  const allShown = [...sessionMedia, ...assocNotInSession, ...shownMore];
  const hasMore = moreCount < morePool.length;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setUploadError(null);
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      const baseName = postTitle ? `${toSeoSlug(postTitle)}${ext}` : file.name;
      const renamedFile = new File([file], baseName, { type: file.type });
      const fd = new FormData();
      fd.append("file", renamedFile);
      const result = await uploadMedia(fd);
      if ("error" in result && result.error) {
        setUploadError(result.error);
      } else if (result.id && result.url) {
        onUpload({ id: result.id, url: result.url, fileName: file.name });
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex flex-col">
      {/* Upload dropzone */}
      <div
        className={`shrink-0 border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors select-none ${
          dragOver ? "border-blue-400 bg-blue-50" : "border-zinc-200 hover:border-zinc-300 bg-zinc-50"
        }`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
        {uploading ? (
          <p className="text-xs text-zinc-400">Uploading…</p>
        ) : (
          <>
            <svg className="w-5 h-5 mx-auto text-zinc-300 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-xs text-zinc-400">Drop images or <span className="text-blue-500">browse</span></p>
          </>
        )}
      </div>

      {uploadError && <p className="text-xs text-red-500 mt-1 shrink-0">{uploadError}</p>}

      {/* Thumbnail grid */}
      <div className="mt-2">
        {allShown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-zinc-300">
            <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-xs">No images yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-1.5">
            {allShown.map(item => {
              const isSession = sessionIds.has(item.id);
              const isAssoc = !isSession && assocNotInSession.some(m => m.id === item.id);
              const badge = isSession ? "New" : (isAssoc && mode === "edit" ? "In post" : null);
              return (
                <ImageThumb
                  key={item.id}
                  item={item}
                  isFeatured={featuredId === item.id}
                  badge={badge}
                  onInsert={() => onInsert(item.url, fileNameToAlt(item.fileName))}
                  onFeatured={() => onFeaturedChange(featuredId === item.id ? null : item.id)}
                />
              );
            })}
          </div>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={() => setMoreCount(c => c + PAGE_SIZE)}
            className="mt-2 w-full text-xs text-zinc-400 hover:text-zinc-600 py-2 border border-dashed border-zinc-200 rounded-lg transition-colors"
          >
            Load {Math.min(PAGE_SIZE, morePool.length - moreCount)} more
          </button>
        )}
      </div>
    </div>
  );
}

function ImageThumb({
  item, isFeatured, badge, onInsert, onFeatured,
}: {
  item: MediaItem;
  isFeatured: boolean;
  badge: string | null;
  onInsert: () => void;
  onFeatured: () => void;
}) {
  return (
    <div
      className="relative group rounded-md overflow-hidden bg-zinc-100 aspect-square cursor-pointer"
      draggable
      onDragStart={e => {
        e.dataTransfer.setData(
          "application/pugmill-image",
          JSON.stringify({ url: item.url, alt: fileNameToAlt(item.fileName) })
        );
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onInsert}
      title={`Click to insert · Drag into editor\n${item.fileName}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.url} alt={item.fileName} className="w-full h-full object-cover" />

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

      {/* Badge */}
      {badge && (
        <span className={`absolute bottom-1 left-1 text-[9px] font-semibold px-1 py-0.5 rounded leading-none ${
          badge === "New" ? "bg-green-500 text-white" : "bg-blue-500/80 text-white"
        }`}>
          {badge}
        </span>
      )}

      {/* Featured pill */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onFeatured(); }}
        className={`absolute top-1 right-1 text-[10px] font-semibold px-2 py-0.5 rounded-full leading-none transition-all ${
          isFeatured
            ? "bg-amber-400 text-white opacity-100"
            : "bg-black/50 text-white opacity-0 group-hover:opacity-100"
        }`}
        title={isFeatured ? "Remove as featured image" : "Set as featured image"}
      >
        {isFeatured ? "Featured" : "Set featured"}
      </button>
    </div>
  );
}
