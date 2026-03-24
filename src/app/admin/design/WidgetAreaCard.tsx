"use client";
import { useState, useTransition, useEffect, useRef } from "react";

interface WidgetInfo {
  id: string;
  label: string;
  description?: string;
}

interface Props {
  areaId: string;
  areaLabel: string;
  initialWidgetIds: string[];
  availableWidgets: WidgetInfo[];
  saveAction: (areaId: string, widgetIds: string[]) => Promise<void>;
}

export default function WidgetAreaCard({
  areaId,
  areaLabel,
  initialWidgetIds,
  availableWidgets,
  saveAction,
}: Props) {
  const [activeIds, setActiveIds] = useState<string[]>(initialWidgetIds);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  function save(ids: string[]) {
    setSaved(false);
    startTransition(async () => {
      await saveAction(areaId, ids);
      setSaved(true);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    });
  }

  function add(id: string) {
    const next = [...activeIds, id];
    setActiveIds(next);
    save(next);
  }

  function remove(id: string) {
    const next = activeIds.filter(w => w !== id);
    setActiveIds(next);
    save(next);
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...activeIds];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setActiveIds(next);
    save(next);
  }

  function moveDown(index: number) {
    if (index === activeIds.length - 1) return;
    const next = [...activeIds];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setActiveIds(next);
    save(next);
  }

  const inactive = availableWidgets.filter(w => !activeIds.includes(w.id));

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-100">
        <h3 className="text-base font-semibold text-zinc-800">{areaLabel}</h3>
        {isPending && <span className="text-xs text-zinc-400">Saving…</span>}
        {!isPending && saved && <span className="text-xs text-green-600">Saved</span>}
      </div>

      {/* Active widgets */}
      {activeIds.length === 0 ? (
        <p className="text-sm text-zinc-500 italic">No widgets active — add one below.</p>
      ) : (
        <ul className="space-y-2">
          {activeIds.map((id, i) => {
            const info = availableWidgets.find(w => w.id === id);
            return (
              <li key={id} className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-zinc-800">
                    {info?.label ?? id}
                  </span>
                  {info?.description && (
                    <p className="text-xs text-zinc-500 truncate">{info.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-700 disabled:opacity-25 transition-colors"
                    title="Move up"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(i)}
                    disabled={i === activeIds.length - 1}
                    className="p-1 rounded text-zinc-400 hover:text-zinc-700 disabled:opacity-25 transition-colors"
                    title="Move down"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(id)}
                    className="p-1 rounded text-zinc-400 hover:text-red-500 transition-colors"
                    title="Remove"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add widget picker */}
      {inactive.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <select
            className="flex-1 border border-zinc-200 rounded-lg px-3 py-1.5 text-sm text-zinc-700 bg-white focus:outline-none focus:ring-2 focus:ring-zinc-400"
            defaultValue=""
            onChange={e => { if (e.target.value) { add(e.target.value); e.target.value = ""; } }}
          >
            <option value="" disabled>Add a widget…</option>
            {inactive.map(w => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
