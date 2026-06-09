"use client";

import { useState } from "react";
import { createApiKey } from "@/lib/actions/api-keys";

// ── Types ─────────────────────────────────────────────────────────────────────

type ClientTab = "desktop" | "code" | "cursor" | "cowork";

type KeyState =
  | { phase: "idle" }
  | { phase: "generating" }
  | { phase: "done"; token: string; keyName: string }
  | { phase: "dismissed" };

type TestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "ok"; name: string; version: string; tools: number }
  | { phase: "error"; message: string };

interface Props {
  mcpUrl:       string;
  lastUsedKey?: { prefix: string; lastUsedAt: string | null } | null;
}

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS: { id: ClientTab; label: string }[] = [
  { id: "desktop", label: "Claude Desktop" },
  { id: "code",    label: "Claude Code"    },
  { id: "cursor",  label: "Cursor"         },
  { id: "cowork",  label: "Claude Cowork"  },
];

const DEFAULT_KEY_NAME: Record<ClientTab, string> = {
  desktop: "Claude Desktop",
  code:    "Claude Code",
  cursor:  "Cursor",
  cowork:  "Claude Cowork",
};

// ── Config builders ───────────────────────────────────────────────────────────

const PLACEHOLDER = "YOUR_API_KEY";

function desktopConfig(mcpUrl: string, token: string) {
  return JSON.stringify(
    { mcpServers: { "pugmill-cms": { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } },
    null, 2,
  );
}

function codeCommand(mcpUrl: string, token: string) {
  return `claude mcp add --transport http pugmill-cms ${mcpUrl} \\\n  --header "Authorization: Bearer ${token}"`;
}

function cursorConfig(mcpUrl: string, token: string) {
  return JSON.stringify(
    { mcpServers: { "pugmill-cms": { url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } },
    null, 2,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function CopyButton({ text, small }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  const base = small
    ? "flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded border transition-colors"
    : "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors";
  return (
    <button onClick={copy} className={`${base} ${
      copied
        ? "bg-emerald-50 border-emerald-200 text-emerald-700"
        : "bg-white border-zinc-200 text-zinc-500 hover:text-zinc-800 hover:border-zinc-300"
    }`}>
      {copied ? (
        <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>Copied</>
      ) : (
        <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>Copy</>
      )}
    </button>
  );
}

// ── Snippet display ───────────────────────────────────────────────────────────

function Snippet({ text, token, lang = "json" }: { text: string; token: string; lang?: string }) {
  const isPlaceholder = token === PLACEHOLDER;
  // Highlight just the token value in the snippet
  const highlight = (content: string) => {
    if (isPlaceholder) return <span className="text-zinc-500">{content}</span>;
    const needle = token;
    const idx = content.indexOf(needle);
    if (idx === -1) return <span className="text-zinc-200">{content}</span>;
    return (
      <>
        <span className="text-zinc-200">{content.slice(0, idx)}</span>
        <span className="bg-amber-300 text-amber-900 rounded px-0.5">{needle}</span>
        <span className="text-zinc-200">{content.slice(idx + needle.length)}</span>
      </>
    );
  };
  return (
    <pre className={`rounded-lg p-4 font-mono text-xs overflow-x-auto border transition-colors text-zinc-200 bg-zinc-900 ${
      isPlaceholder ? "border-zinc-700" : "border-amber-600"
    }`} data-lang={lang}>
      {highlight(text)}
    </pre>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function McpKeyGenerator({ mcpUrl, lastUsedKey }: Props) {
  const [activeTab, setActiveTab]   = useState<ClientTab>("desktop");
  const [keyState, setKeyState]     = useState<KeyState>({ phase: "idle" });
  const [testState, setTestState]   = useState<TestState>({ phase: "idle" });
  const [keyName, setKeyName]       = useState(DEFAULT_KEY_NAME["desktop"]);
  const [nameError, setNameError]   = useState<string | null>(null);
  const [writeAccess, setWriteAccess] = useState(true);

  const token = keyState.phase === "done" ? keyState.token : PLACEHOLDER;
  const isPlaceholder = keyState.phase !== "done";

  // Switch tab — reset key name default
  function switchTab(tab: ClientTab) {
    setActiveTab(tab);
    if (keyState.phase === "idle") setKeyName(DEFAULT_KEY_NAME[tab]);
    setTestState({ phase: "idle" });
  }

  // Generate key
  async function handleGenerate() {
    if (!keyName.trim()) { setNameError("Key name is required."); return; }
    setNameError(null);
    setKeyState({ phase: "generating" });
    const fd = new FormData();
    fd.set("name", keyName.trim());
    fd.set("scope", writeAccess ? "readwrite" : "read");
    const result = await createApiKey(fd);
    if ("error" in result) { setKeyState({ phase: "idle" }); setNameError(result.error); return; }
    setKeyState({ phase: "done", token: result.token, keyName: keyName.trim() });
  }

  // Test connection (GET — no auth required)
  async function handleTest() {
    setTestState({ phase: "testing" });
    try {
      const res = await fetch(mcpUrl, { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        setTestState({ phase: "ok", name: data.name, version: data.version, tools: data.tools });
      } else {
        setTestState({ phase: "error", message: `Server returned HTTP ${res.status}` });
      }
    } catch {
      setTestState({ phase: "error", message: "Could not reach the server — check your network or the URL above." });
    }
  }

  // ── Config content per tab ──────────────────────────────────────────────────

  function renderTabContent() {
    if (activeTab === "cowork") {
      return (
        <div className="space-y-4">
          <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4 space-y-3">
            <p className="text-xs font-medium text-zinc-700">Claude Cowork uses a separate connector system</p>
            <p className="text-xs text-zinc-500">
              Cowork is Anthropic&apos;s web-based collaborative product. It does not read{" "}
              <code className="font-mono bg-zinc-100 px-1 rounded">claude_desktop_config.json</code>{" "}
              or the CLI&apos;s MCP config — it has its own connector panel in the UI.
            </p>
            <p className="text-xs font-medium text-zinc-600">To connect in Cowork:</p>
            <ol className="list-decimal list-inside space-y-1.5 text-xs text-zinc-500">
              <li>Generate an API key using the form below and copy it.</li>
              <li>Open Cowork and navigate to <strong className="font-medium text-zinc-600">Connectors</strong> or <strong className="font-medium text-zinc-600">Settings → Integrations</strong>.</li>
              <li>Add a new HTTP connector with the URL and Bearer token shown here.</li>
            </ol>
            <div className="border-t border-zinc-200 pt-3 space-y-2">
              <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Values to paste into Cowork</p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-400 w-10">URL</span>
                <code className="flex-1 text-xs font-mono bg-white border border-zinc-200 rounded px-2 py-1 text-zinc-700 select-all">{mcpUrl}</code>
                <CopyButton text={mcpUrl} small />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-400 w-10">Token</span>
                <code className={`flex-1 text-xs font-mono bg-white border rounded px-2 py-1 select-all truncate ${isPlaceholder ? "border-zinc-200 text-zinc-400 italic" : "border-amber-200 text-zinc-700"}`}>
                  {isPlaceholder ? "generate a key below →" : `Bearer ${token}`}
                </code>
                {!isPlaceholder && <CopyButton text={`Bearer ${token}`} small />}
              </div>
            </div>
          </div>
        </div>
      );
    }

    const snippetText = activeTab === "code" ? codeCommand(mcpUrl, token) : activeTab === "cursor" ? cursorConfig(mcpUrl, token) : desktopConfig(mcpUrl, token);
    const lang = activeTab === "code" ? "bash" : "json";

    return (
      <div className="space-y-3">
        {activeTab === "desktop" && (
          <p className="text-xs text-zinc-500">
            Open <strong className="font-medium text-zinc-600">Settings → Developer → Edit Config</strong> in Claude Desktop and paste the snippet into the{" "}
            <code className="font-mono bg-zinc-100 px-1 rounded">mcpServers</code> object, then restart Claude.
          </p>
        )}
        {activeTab === "code" && (
          <p className="text-xs text-zinc-500">
            Run this command in your terminal. It registers the server globally in Claude Code&apos;s local config — you only need to do it once.
          </p>
        )}
        {activeTab === "cursor" && (
          <p className="text-xs text-zinc-500">
            Paste into <code className="font-mono bg-zinc-100 px-1 rounded">~/.cursor/mcp.json</code> (global) or{" "}
            <code className="font-mono bg-zinc-100 px-1 rounded">.cursor/mcp.json</code> (project-level), then reload Cursor.
          </p>
        )}

        <div className="relative">
          <div className="absolute top-2.5 right-2.5 z-10">
            <CopyButton text={snippetText} />
          </div>
          <Snippet text={snippetText} token={token} lang={lang} />
        </div>

        {isPlaceholder && keyState.phase !== "dismissed" && (
          <p className="text-xs text-zinc-400">
            Generate a key below to fill this in automatically, or paste an existing key manually.
          </p>
        )}
        {keyState.phase === "dismissed" && (
          <p className="text-xs text-zinc-400">
            Key saved to{" "}
            <a href="/admin/settings/api-keys" className="underline hover:text-zinc-600">API Keys</a>.
            Generate a new one below if needed.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Test connection ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Server status</p>
          <button
            onClick={handleTest}
            disabled={testState.phase === "testing"}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-800 hover:border-zinc-300 disabled:opacity-50 transition-colors"
          >
            {testState.phase === "testing" ? (
              <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Testing…</>
            ) : (
              <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>Test connection</>
            )}
          </button>
        </div>
        <div className={`flex items-center gap-2.5 rounded-lg px-4 py-2.5 border text-xs transition-colors ${
          testState.phase === "ok"    ? "bg-emerald-50 border-emerald-200 text-emerald-800" :
          testState.phase === "error" ? "bg-red-50 border-red-200 text-red-800" :
          "bg-zinc-50 border-zinc-200 text-zinc-400"
        }`}>
          {testState.phase === "ok" && (
            <><svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
            Connected — <strong className="font-medium">{testState.name} v{testState.version}</strong> · {testState.tools} tools available</>
          )}
          {testState.phase === "error" && (
            <><svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            {testState.message}</>
          )}
          {(testState.phase === "idle" || testState.phase === "testing") && (
            <span>Click &ldquo;Test connection&rdquo; to verify the server is reachable</span>
          )}
        </div>
        {lastUsedKey && (
          <p className="text-[10px] text-zinc-400 mt-1.5">
            Last authenticated request: key <code className="font-mono">{lastUsedKey.prefix}…</code> · {timeAgo(lastUsedKey.lastUsedAt)}
          </p>
        )}
      </div>

      {/* ── Client tabs + config snippet ──────────────────────────────────── */}
      <div>
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">Setup for your client</p>
        {/* Tab bar */}
        <div className="flex border-b border-zinc-200 mb-4">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? "border-zinc-900 text-zinc-900"
                  : "border-transparent text-zinc-400 hover:text-zinc-600"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {renderTabContent()}
      </div>

      {/* ── Key generator ─────────────────────────────────────────────────── */}
      {keyState.phase !== "dismissed" && (
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
            {keyState.phase === "done" ? "Key generated" : "Generate a key"}
          </p>
          {keyState.phase === "done" ? (
            <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
              <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-800">&ldquo;{keyState.keyName}&rdquo; created and saved to API Keys.</p>
                <p className="text-xs text-emerald-600 mt-0.5">The key is filled into the config above — copy it before dismissing.</p>
              </div>
              <button onClick={() => setKeyState({ phase: "dismissed" })} className="text-xs text-emerald-700 underline underline-offset-2 flex-shrink-0 hover:text-emerald-900">
                Dismiss
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">
                  Key name <span className="text-zinc-400">(shown in API Keys — helps you identify it later)</span>
                </label>
                <div className="flex gap-2 items-start">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={keyName}
                      onChange={e => { setKeyName(e.target.value); setNameError(null); }}
                      placeholder={DEFAULT_KEY_NAME[activeTab]}
                      maxLength={100}
                      disabled={keyState.phase === "generating"}
                      className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50"
                    />
                    {nameError && <p className="text-xs text-red-500 mt-1">{nameError}</p>}
                  </div>
                  <button
                    onClick={handleGenerate}
                    disabled={keyState.phase === "generating"}
                    className="flex-shrink-0 bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-zinc-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {keyState.phase === "generating" ? "Generating…" : "Generate key"}
                  </button>
                </div>
                <label className="flex items-start gap-2 mt-2 text-xs text-zinc-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={writeAccess}
                    onChange={(e) => setWriteAccess(e.target.checked)}
                    disabled={keyState.phase === "generating"}
                    className="mt-0.5"
                  />
                  <span>
                    Allow this agent to <strong className="text-zinc-600">create, edit, and publish</strong> content
                    (read &amp; write). Uncheck for a read-only key that can browse content but never change it.
                  </span>
                </label>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
