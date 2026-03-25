import { db } from "@/lib/db";
import { posts, media, adminUsers, sessions, themeDesignConfigs } from "@/lib/db/schema";
import { sql, gte, isNotNull, notInArray, eq } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { isDevUrl } from "@/lib/detect-site-url";
import DashboardCharts from "@/components/admin/DashboardCharts";
import GettingStartedCard from "@/components/admin/GettingStartedCard";

function buildMonthlyBuckets(n: number): { key: string; label: string }[] {
  const result: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-US", { month: "short" });
    result.push({ key, label });
  }
  return result;
}

export default async function AdminDashboard() {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  twelveMonthsAgo.setDate(1);

  // Subquery for used media IDs
  const usedMediaIds = db
    .select({ id: posts.featuredImage })
    .from(posts)
    .where(isNotNull(posts.featuredImage));

  const [config, counts, totalMediaRows, unusedMediaRows, monthlyRaw, allUsers, lastActiveSessions, publishedDesign, publishedPost, anyAuthorVoice] =
    await Promise.all([
      getConfig(),
      db
        .select({
          type: posts.type,
          published: posts.published,
          count: sql<number>`count(*)::int`,
        })
        .from(posts)
        .groupBy(posts.type, posts.published),

      db.select({ id: media.id }).from(media),

      db.select({ id: media.id }).from(media).where(notInArray(media.id, usedMediaIds)),

      db
        .select({
          month: sql<string>`TO_CHAR(DATE_TRUNC('month', ${posts.createdAt}), 'YYYY-MM')`,
          type: posts.type,
          count: sql<number>`count(*)::int`,
        })
        .from(posts)
        .where(gte(posts.createdAt, twelveMonthsAgo))
        .groupBy(sql`DATE_TRUNC('month', ${posts.createdAt})`, posts.type)
        .orderBy(sql`DATE_TRUNC('month', ${posts.createdAt})`),

      db
        .select({
          id: adminUsers.id,
          name: adminUsers.name,
          email: adminUsers.email,
          role: adminUsers.role,
          createdAt: adminUsers.createdAt,
        })
        .from(adminUsers)
        .orderBy(adminUsers.createdAt),

      // Most recent session per user — expires ≈ lastLogin + 30 days
      db
        .select({
          userId: sessions.userId,
          lastExpires: sql<Date>`MAX(${sessions.expires})`,
        })
        .from(sessions)
        .groupBy(sessions.userId),

      // Onboarding: has a published design config (design customized)?
      db.select({ id: themeDesignConfigs.id })
        .from(themeDesignConfigs)
        .where(eq(themeDesignConfigs.status, "published"))
        .limit(1),

      // Onboarding: has at least one published post?
      db.select({ id: posts.id })
        .from(posts)
        .where(sql`${posts.type} = 'post' AND ${posts.published} = true`)
        .limit(1),

      // Onboarding: has any admin set their author voice?
      db.select({ authorVoice: adminUsers.authorVoice })
        .from(adminUsers)
        .where(isNotNull(adminUsers.authorVoice))
        .limit(1),
    ]);

  const buckets = buildMonthlyBuckets(12);
  const monthlyIndex: Record<string, { posts: number; pages: number }> = {};
  for (const b of buckets) monthlyIndex[b.key] = { posts: 0, pages: 0 };
  for (const row of monthlyRaw) {
    if (monthlyIndex[row.month]) {
      if (row.type === "post") monthlyIndex[row.month].posts = row.count;
      if (row.type === "page") monthlyIndex[row.month].pages = row.count;
    }
  }
  const monthly = buckets.map(b => ({ month: b.label, ...monthlyIndex[b.key] }));

  const sum = (type: string, published?: boolean) =>
    counts
      .filter(r => r.type === type && (published === undefined || r.published === published))
      .reduce((acc, r) => acc + r.count, 0);

  const postStatus = [
    { name: "Published", value: sum("post", true) },
    { name: "Draft", value: sum("post", false) },
  ];
  const pageStatus = [
    { name: "Published", value: sum("page", true) },
    { name: "Draft", value: sum("page", false) },
  ];

  // Build user list with approximate last-active derived from session expiry
  // NextAuth default session maxAge is 30 days; expires = createdAt + 30d
  const SESSION_MAXAGE_MS = 30 * 24 * 60 * 60 * 1000;
  const sessionMap = new Map(
    lastActiveSessions.map(s => [
      s.userId,
      new Date(new Date(s.lastExpires).getTime() - SESSION_MAXAGE_MS),
    ]),
  );

  const users = allUsers.map(u => ({
    ...u,
    lastActive: sessionMap.get(u.id) ?? null,
  }));

  // Onboarding steps
  const onboardingSteps = [
    {
      label: "Set your site identity",
      description: "Add your site name, URL, and description in Settings.",
      done: config.site.name !== "My Pugmill Site" && config.site.name.trim() !== "",
      href: "/admin/settings",
    },
    {
      label: "Configure an AI provider",
      description: "Connect Anthropic, OpenAI, or Gemini to unlock AI-powered features.",
      done: config.ai.provider !== null,
      href: "/admin/settings/ai",
    },
    {
      label: "Set your author voice",
      description: "Add a writing style description so AI suggestions match your tone.",
      done: anyAuthorVoice.length > 0,
      href: "/admin/profile",
    },
    {
      label: "Customize your design",
      description: "Adjust colors, fonts, and layout to make Pugmill your own.",
      done: publishedDesign.length > 0,
      href: "/admin/design",
    },
    {
      label: "Publish your first post",
      description: "Create and publish a post to put your site on the map.",
      done: publishedPost.length > 0,
      href: "/admin/posts/new",
    },
  ];
  const allStepsDone = onboardingSteps.every(s => s.done);
  const showOnboarding = !config.system.onboardingDismissed && !allStepsDone;
  const showUrlWarning = isDevUrl(config.site.url);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-zinc-800">Dashboard</h2>

      {showUrlWarning && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
          <p className="text-sm font-semibold text-amber-800 mb-1">
            Action required before going live: set your production URL
          </p>
          <p className="text-sm text-amber-700 mb-2">
            Your site URL is currently set to <code className="bg-amber-100 px-1 rounded font-mono text-xs">{config.site.url}</code>, which is a development address.
            Authentication will not work correctly on a custom domain until <code className="bg-amber-100 px-1 rounded font-mono text-xs">NEXTAUTH_URL</code> is updated to your real URL (e.g. <code className="bg-amber-100 px-1 rounded font-mono text-xs">https://yourdomain.com</code>).
          </p>
          <p className="text-sm text-amber-700">
            <strong>To fix:</strong> update the <code className="bg-amber-100 px-1 rounded font-mono text-xs">NEXTAUTH_URL</code> environment variable in your host&apos;s secrets or environment settings to your production domain, then redeploy.
            You can ask your AI agent to do this — tell it: <em>&quot;Set NEXTAUTH_URL to https://yourdomain.com in the environment secrets.&quot;</em>
            Once set, this notice will disappear automatically.
          </p>
        </div>
      )}

      {showOnboarding && <GettingStartedCard steps={onboardingSteps} />}
      <DashboardCharts
        monthly={monthly}
        postStatus={postStatus}
        pageStatus={pageStatus}
        totalMedia={totalMediaRows.length}
        unusedMedia={unusedMediaRows.length}
        users={users}
      />
    </div>
  );
}
