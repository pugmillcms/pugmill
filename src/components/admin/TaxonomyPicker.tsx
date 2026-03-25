"use client";
import { useState, useRef } from "react";

type Item = { id: number; name: string; slug: string };

interface Props {
  label: string;
  fieldName: string;
  items: Item[];
  selectedIds?: Set<number>;
  onCreate: (name: string) => Promise<Item>;
  onAiSuggest?: () => void;
  aiPending?: boolean;
  suggestions?: string[];
  onSuggestDismiss?: () => void;
}

export default function TaxonomyPicker({ label, fieldName, items, selectedIds, onCreate, onAiSuggest, aiPending, suggestions, onSuggestDismiss }: Props) {
  const [all, setAll] = useState<Item[]>(items);
  const [selected, setSelected] = useState<Set<number>>(selectedIds ?? new Set());
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [applyingName, setApplyingName] = useState<string | null>(null);
  const [appliedSuggestions, setAppliedSuggestions] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function add(id: number) {
    setSelected(prev => new Set([...prev, id]));
  }

  function remove(id: number) {
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
  }

  async function handleApplySuggestion(name: string) {
    setApplyingName(name);
    const existing = all.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      add(existing.id);
    } else {
      try {
        const created = await onCreate(name);
        setAll(prev => [...prev, created]);
        add(created.id);
      } catch {
        // silently ignore — user can add manually
      }
    }
    setAppliedSuggestions(prev => new Set([...prev, name]));
    setApplyingName(null);
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError("");
    try {
      const created = await onCreate(name);
      setAll(prev => [...prev, created]);
      add(created.id);
      setNewName("");
      inputRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setAdding(false);
    }
  }

  const selectedItems = all.filter(item => selected.has(item.id));
  const availableItems = all.filter(item => !selected.has(item.id));
  const singularLabel = label.toLowerCase().replace(/s$/, "");

  return (
    <div className="space-y-2">
      {/* Label row */}
      <div className="flex items-center justify-between mb-1">
        <label className="block text-sm font-medium text-zinc-700">{label}</label>
        {onAiSuggest && (
          <button
            type="button"
            onClick={onAiSuggest}
            disabled={aiPending}
            className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 disabled:opacity-40 transition"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {aiPending ? "…" : "Suggest"}
          </button>
        )}
      </div>

      {/* AI suggestions */}
      {suggestions && suggestions.filter(s => !appliedSuggestions.has(s)).length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 py-1">
          <span className="text-xs text-zinc-400">AI suggested:</span>
          {suggestions.filter(s => !appliedSuggestions.has(s)).map(name => (
            <button
              key={name}
              type="button"
              onClick={() => handleApplySuggestion(name)}
              disabled={applyingName === name}
              className="text-xs px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition"
            >
              {applyingName === name ? "…" : `+ ${name}`}
            </button>
          ))}
          {onSuggestDismiss && (
            <button type="button" onClick={onSuggestDismiss} aria-label="Dismiss suggestions" className="text-xs text-zinc-400 hover:text-zinc-600 ml-1">✕</button>
          )}
        </div>
      )}

      {/* Hidden inputs carry selected IDs to the server action */}
      {Array.from(selected).map(id => (
        <input key={id} type="hidden" name={fieldName} value={id} />
      ))}

      <div className="border border-zinc-200 rounded-lg bg-zinc-50 divide-y">
        {/* Selected chips */}
        {selectedItems.length > 0 && (
          <div className="flex flex-wrap gap-1.5 p-3">
            {selectedItems.map(item => (
              <span
                key={item.id}
                className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-100 border border-blue-200 text-blue-800"
              >
                {item.name}
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  className="ml-0.5 text-blue-500 hover:text-blue-800 leading-none transition"
                  aria-label={`Remove ${item.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Available items to add */}
        {availableItems.length > 0 && (
          <div className="flex flex-wrap gap-1.5 p-3">
            {availableItems.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => add(item.id)}
                className="text-xs px-2.5 py-1 rounded-full bg-white border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition"
              >
                + {item.name}
              </button>
            ))}
            {availableItems.length > 1 && (
              <button
                type="button"
                onClick={() => setSelected(prev => new Set([...prev, ...availableItems.map(i => i.id)]))}
                className="text-xs px-2.5 py-1 rounded-full bg-white border border-zinc-300 text-zinc-500 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition"
              >
                + Add all
              </button>
            )}
          </div>
        )}

        {all.length === 0 && (
          <p className="px-3 py-2 text-sm text-zinc-400">No {label.toLowerCase()} yet — create one below.</p>
        )}

        {/* Inline add */}
        <div className="flex items-center gap-2 px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
            placeholder={`New ${singularLabel}…`}
            className="flex-1 border border-zinc-200 rounded px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className="px-3 py-1.5 bg-white border border-zinc-200 rounded text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 transition"
          >
            {adding ? "…" : "+ Add"}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
