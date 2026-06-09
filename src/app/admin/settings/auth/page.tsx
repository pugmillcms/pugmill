import type { Metadata } from "next";

export const metadata: Metadata = { title: "OAuth Sign-in" };

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/get-current-user";
import { getConfig } from "@/lib/config";
import { saveAuthSettings } from "@/lib/actions/auth-settings";
import { PageShell, Field, SaveButton } from "../_components";

export default async function AuthSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/admin");

  const [config, sp] = await Promise.all([getConfig(), searchParams]);
  const authCfg = config.auth;
  const saved = sp.toast === "saved";

  const hasGoogle = !!(authCfg?.googleClientId && authCfg?.googleClientSecret);
  const hasGitHub = !!(authCfg?.githubClientId && authCfg?.githubClientSecret);

  // Derive the callback base URL from site config
  const siteUrl = config.site.url.replace(/\/$/, "");
  const googleCallbackUrl = `${siteUrl}/api/auth/callback/google`;
  const githubCallbackUrl = `${siteUrl}/api/auth/callback/github`;

  return (
    <PageShell
      title="OAuth Sign-in"
      description="Allow admins to sign in with Google or GitHub. Credentials are stored encrypted and never exposed in logs or API responses."
      saved={saved}
    >
      {(hasGoogle || hasGitHub) && (
        <div className="flex gap-3 flex-wrap">
          {hasGoogle && (
            <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              Google active
            </span>
          )}
          {hasGitHub && (
            <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
              GitHub active
            </span>
          )}
        </div>
      )}

      <form action={saveAuthSettings} className="space-y-8">

        {/* Google */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-700">Google</h3>
            <p className="text-xs text-zinc-400 mt-0.5 space-y-1">
              Create credentials at{" "}
              <span className="font-mono text-zinc-500">console.cloud.google.com</span>
              {" → "}APIs &amp; Services → Credentials → OAuth 2.0 Client ID.
              Set the authorized redirect URI to:
            </p>
            <code className="block mt-1.5 text-xs bg-zinc-50 border border-zinc-200 rounded px-3 py-2 text-zinc-700 break-all">
              {googleCallbackUrl}
            </code>
          </div>
          <Field
            label="Client ID"
            name="googleClientId"
            defaultValue={authCfg?.googleClientId}
            placeholder="123456789-abc.apps.googleusercontent.com"
          />
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Client secret</label>
            <input
              name="googleClientSecret"
              type="password"
              defaultValue={authCfg?.googleClientSecret ? "__REDACTED__" : ""}
              placeholder={authCfg?.googleClientSecret ? "Secret saved — paste new secret to change" : "GOCSPX-..."}
              autoComplete="off"
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
          </div>
        </div>

        {/* GitHub */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-700">GitHub</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Create an OAuth App at{" "}
              <span className="font-mono text-zinc-500">github.com/settings/developers</span>
              {" → "}OAuth Apps → New OAuth App.
              Set the authorization callback URL to:
            </p>
            <code className="block mt-1.5 text-xs bg-zinc-50 border border-zinc-200 rounded px-3 py-2 text-zinc-700 break-all">
              {githubCallbackUrl}
            </code>
          </div>
          <Field
            label="Client ID"
            name="githubClientId"
            defaultValue={authCfg?.githubClientId}
            placeholder="Ov23li..."
          />
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Client secret</label>
            <input
              name="githubClientSecret"
              type="password"
              defaultValue={authCfg?.githubClientSecret ? "__REDACTED__" : ""}
              placeholder={authCfg?.githubClientSecret ? "Secret saved — paste new secret to change" : "GitHub client secret"}
              autoComplete="off"
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
          </div>
        </div>

        {/* Self-provisioning allowlist */}
        <div className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-700">Who may sign up via OAuth</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              By default, signing in with Google or GitHub does <strong className="text-zinc-600">not</strong> create
              an account — that would let anyone on the internet self-register. List the emails or domains allowed to
              be provisioned (as editors) on first sign-in. Existing users always sign in regardless of this list.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Allowed emails</label>
            <textarea
              name="oauthAllowedEmails"
              rows={2}
              defaultValue={(authCfg?.oauthAllowedEmails ?? []).join("\n")}
              placeholder="alice@example.com, bob@example.com"
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <p className="text-[11px] text-zinc-400 mt-1">Comma- or newline-separated.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Allowed domains</label>
            <input
              name="oauthAllowedDomains"
              defaultValue={(authCfg?.oauthAllowedDomains ?? []).join(", ")}
              placeholder="example.com"
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <p className="text-[11px] text-zinc-400 mt-1">Any email at these domains may self-provision. Use with care.</p>
          </div>
        </div>

        <div className="bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-3 text-xs text-zinc-500 space-y-1">
          <p>
            <strong className="text-zinc-700">How it works:</strong> Credentials saved here are encrypted and stored in the database.
          </p>
          <p>
            <strong className="text-zinc-600">Replit:</strong> Credentials are automatically loaded from the database into the server environment at startup — no Replit secrets panel entry required. Restart the dev server (or redeploy) after saving for changes to take effect.
          </p>
          <p>
            <strong className="text-zinc-600">Other platforms:</strong> Set <code className="bg-zinc-100 px-1 rounded">GITHUB_CLIENT_ID</code>, <code className="bg-zinc-100 px-1 rounded">GITHUB_CLIENT_SECRET</code>, <code className="bg-zinc-100 px-1 rounded">GOOGLE_CLIENT_ID</code>, and <code className="bg-zinc-100 px-1 rounded">GOOGLE_CLIENT_SECRET</code> as environment variables in your host&apos;s secrets panel. Values saved here are ignored on these platforms.
          </p>
          <p>
            On a brand-new install the first account to sign in becomes the admin (bootstrap). After that, only emails/domains in the allowlist above can self-provision (as editors, promotable in <a href="/admin/users" className="underline text-zinc-600">Users</a>); everyone else is turned away.
          </p>
        </div>

        <SaveButton label="Save OAuth settings" />
      </form>
    </PageShell>
  );
}
