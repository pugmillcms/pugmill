"use client";
import { useState } from "react";
import Image from "next/image";
import MediaDropZone, { UploadedMediaItem } from "@/components/admin/MediaDropZone";

interface MediaItem { id: number; url: string; fileName: string; }

interface Props {
  label: string;
  name: string;
  defaultValue?: string;
  hint?: string;
  allMedia: MediaItem[];
}

function isImageUrl(url: string) {
  return /\.(jpg|jpeg|png|gif|webp|svg|avif|ico)(\?.*)?$/i.test(url);
}

export default function MediaUrlPicker({ label, name, defaultValue, hint, allMedia }: Props) {
  const [url, setUrl] = useState(defaultValue ?? "");
  const [panelOpen, setPanelOpen] = useState(false);
  const [localMedia, setLocalMedia] = useState<MediaItem[]>(allMedia);
  const [refreshing, setRefreshing] = useState(false);

  async function openPanel() {
    if (panelOpen) { setPanelOpen(false); return; }
    setPanelOpen(true);
    setRefreshing(true);
    try {
      const res = await fetch("/api/media?limit=200");
      if (res.ok) {
        const json = await res.json();
        const items: MediaItem[] = (json.data ?? []).map((m: { id: number; url: string; fileName: string }) => ({
          id: m.id, url: m.url, fileName: m.fileName,
        }));
        setLocalMedia(items);
      }
    } catch { /* silently keep existing list */ }
    finally { setRefreshing(false); }
  }

  function select(item: MediaItem) {
    setUrl(item.url);
    setPanelOpen(false);
  }

  function onUploaded(items: UploadedMediaItem[]) {
    const newItems = items.map(i => ({ id: i.id, url: i.url, fileName: i.fileName }));
    setLocalMedia(prev => [...newItems, ...prev]);
    setUrl(newItems[0].url);
    setPanelOpen(false);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700 mb-1">{label}</label>

      {url && isImageUrl(url) && (
        <div className="mb-2 relative h-14 w-28 rounded-lg overflow-hidden border border-zinc-200 bg-zinc-200">
          <Image src={url} alt="" fill className="object-contain p-1" sizes="112px" unoptimized />
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          name={name}
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://… or /uploads/image.png"
          className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 min-w-0"
        />
        <button
          type="button"
          onClick={openPanel}
          className={`shrink-0 px-3 py-2 text-sm border rounded-lg bg-white transition-colors ${
            panelOpen
              ? "border-zinc-500 text-zinc-900"
              : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          }`}
        >
          {refreshing ? "…" : "Library"}
        </button>
        {url && (
          <button
            type="button"
            onClick={() => setUrl("")}
            className="shrink-0 px-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white text-zinc-400 hover:text-red-500 hover:border-red-200 transition-colors"
            aria-label="Clear"
          >
            ✕
          </button>
        )}
      </div>

      {hint && <p className="text-xs text-zinc-400 mt-1">{hint}</p>}

      {/* Inline panel */}
      {panelOpen && (
        <div className="mt-2 border border-zinc-200 rounded-lg overflow-hidden bg-white">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 bg-zinc-50">
            <span className="text-xs font-medium text-zinc-600">
              Media Library · {localMedia.length} file{localMedia.length !== 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="text-zinc-400 hover:text-zinc-700 transition-colors"
              aria-label="Close panel"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-3 space-y-3">
            <MediaDropZone onUploaded={onUploaded} compact />

            {localMedia.length > 0 ? (
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-48 overflow-y-auto">
                {localMedia.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => select(item)}
                    className={`relative aspect-square rounded-md overflow-hidden border-2 transition-colors ${
                      url === item.url
                        ? "border-zinc-900 ring-2 ring-zinc-200"
                        : "border-zinc-200 hover:border-zinc-500"
                    }`}
                    title={item.fileName}
                  >
                    <Image
                      src={item.url}
                      alt={item.fileName}
                      fill
                      className="object-cover"
                      sizes="100px"
                      unoptimized
                    />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-400 text-center py-4">No files uploaded yet. Drop one above.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
