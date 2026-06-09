"use client";
import { useState, useRef } from "react";
import { createApiKey, revokeApiKey } from "@/lib/actions/api-keys";
import { useRouter } from "next/navigation";

interface Key {
  id: number;
  name: string;
  keyPrefix: string;
  scope: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export function CreateKeyForm() {
  const [pending, setPending] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const result = await createApiKey(fd);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setNewToken(result.token);
    formRef.current?.reset();
    router.refresh();
  }

  async function copyToken() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <form ref={formRef} onSubmit={handleSubmit} className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-zinc-700 mb-1">Key name</label>
          <input
            name="name"
            placeholder="e.g. My headless frontend"
            required
            maxLength={100}
            className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          />
        </div>
        <div className="w-44">
          <label className="block text-sm font-medium text-zinc-700 mb-1">Scope</label>
          <select
            name="scope"
            defaultValue="read"
            className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-zinc-400"
          >
            <option value="read">Read-only</option>
            <option value="readwrite">Read &amp; write</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-700 disabled:opacity-50 transition-colors shrink-0"
        >
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>
      <p className="text-xs text-zinc-400 -mt-1">
        Read-only keys can read content via the REST API and MCP. Read &amp; write keys can also
        create, edit, and publish content through the MCP server — only grant this to agents you trust.
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {newToken && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-800">
            Copy this token now — it will never be shown again.
          </p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 bg-white border border-amber-200 rounded px-3 py-2 text-xs font-mono break-all text-zinc-800">
              {newToken}
            </code>
            <button
              onClick={copyToken}
              className="shrink-0 bg-amber-700 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-amber-800 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setNewToken(null)}
            className="text-xs text-amber-700 underline"
          >
            I&apos;ve saved it — dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export function RevokeKeyButton({ id, name }: { id: number; name: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleRevoke() {
    if (!confirm(`Revoke key "${name}"? Any integrations using it will stop working immediately.`)) return;
    setPending(true);
    await revokeApiKey(id);
    setPending(false);
    router.refresh();
  }

  return (
    <button
      onClick={handleRevoke}
      disabled={pending}
      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 font-medium transition-colors"
    >
      {pending ? "Revoking…" : "Revoke"}
    </button>
  );
}
