import type { Metadata } from "next";

export const metadata: Metadata = { title: "API Keys" };

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-current-user";
import { listApiKeys } from "@/lib/actions/api-keys";
import { CreateKeyForm, RevokeKeyButton } from "./ApiKeyActions";

function formatDate(d: Date | null) {
  if (!d) return "Never";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d));
}

export default async function ApiKeysPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/admin");

  const keys = await listApiKeys();
  const active = keys.filter((k) => !k.revokedAt);
  const revoked = keys.filter((k) => k.revokedAt);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900">API Keys</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Keys authenticate requests to the public REST API (<code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">/api/posts</code>,{" "}
          <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">/api/media</code>, etc.) and the MCP server.
          Authenticated requests get a higher rate limit (600 req/min vs 60).
          Pass the token as <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">Authorization: Bearer &lt;token&gt;</code>.
          <strong className="text-zinc-600"> Read-only</strong> keys can only read;
          <strong className="text-zinc-600"> read &amp; write</strong> keys can also create, edit, and publish content via MCP.
        </p>
      </div>

      {/* Create */}
      <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-700">Create new key</h3>
        <CreateKeyForm />
      </div>

      {/* Active keys */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100">
          <h3 className="text-sm font-semibold text-zinc-700">
            Active keys <span className="text-zinc-400 font-normal">({active.length})</span>
          </h3>
        </div>
        {active.length === 0 ? (
          <p className="px-6 py-8 text-sm text-zinc-400 text-center">No active keys yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Name</th>
                <th className="px-6 py-3 text-left font-medium">Prefix</th>
                <th className="px-6 py-3 text-left font-medium">Scope</th>
                <th className="px-6 py-3 text-left font-medium">Last used</th>
                <th className="px-6 py-3 text-left font-medium">Created</th>
                <th className="px-6 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {active.map((key) => (
                <tr key={key.id} className="hover:bg-zinc-50">
                  <td className="px-6 py-3 font-medium text-zinc-800">{key.name}</td>
                  <td className="px-6 py-3">
                    <code className="text-xs font-mono bg-zinc-100 px-1.5 py-0.5 rounded text-zinc-600">
                      {key.keyPrefix}…
                    </code>
                  </td>
                  <td className="px-6 py-3">
                    {key.scope === "readwrite" ? (
                      <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
                        Read &amp; write
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-500">
                        Read-only
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-zinc-500">{formatDate(key.lastUsedAt)}</td>
                  <td className="px-6 py-3 text-zinc-500">{formatDate(key.createdAt)}</td>
                  <td className="px-6 py-3 text-right">
                    <RevokeKeyButton id={key.id} name={key.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Revoked keys — shown only if any exist */}
      {revoked.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden opacity-60">
          <div className="px-6 py-4 border-b border-zinc-100">
            <h3 className="text-sm font-semibold text-zinc-500">
              Revoked <span className="font-normal">({revoked.length})</span>
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Name</th>
                <th className="px-6 py-3 text-left font-medium">Prefix</th>
                <th className="px-6 py-3 text-left font-medium">Revoked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {revoked.map((key) => (
                <tr key={key.id}>
                  <td className="px-6 py-3 text-zinc-400 line-through">{key.name}</td>
                  <td className="px-6 py-3">
                    <code className="text-xs font-mono text-zinc-300">{key.keyPrefix}…</code>
                  </td>
                  <td className="px-6 py-3 text-zinc-400">{formatDate(key.revokedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
