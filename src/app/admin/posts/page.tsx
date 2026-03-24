import Link from "next/link";
import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { eq, and, asc, desc } from "drizzle-orm";
import { DeletePostButton } from "./DeletePostButton";
import { parseAeoMetadata, calcAeoScore } from "@/lib/aeo";

type SearchParams = {
  type?: string;
  status?: string;
  sort?: string;
  order?: string;
};

function buildUrl(current: SearchParams, patch: Partial<SearchParams>) {
  const next = { ...current, ...patch };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) {
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return `/admin/posts${qs ? `?${qs}` : ""}`;
}

function sortHref(current: SearchParams, col: string) {
  if (current.sort === col) {
    return buildUrl(current, { sort: col, order: current.order === "asc" ? "desc" : "asc" });
  }
  return buildUrl(current, { sort: col, order: "asc" });
}

function SortIcon({ current, col }: { current: SearchParams; col: string }) {
  if (current.sort !== col) return <span className="ml-1 text-zinc-300">↕</span>;
  return <span className="ml-1 text-zinc-600">{current.order === "asc" ? "↑" : "↓"}</span>;
}

function FilterPill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        active ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function PostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const typeFilter = sp.type ?? "";
  const statusFilter = sp.status ?? "";
  const sortCol = sp.sort ?? "date";
  const sortDir = sp.order ?? "desc";

  const conditions = [];
  if (typeFilter === "post") conditions.push(eq(posts.type, "post"));
  if (typeFilter === "page") conditions.push(eq(posts.type, "page"));
  if (statusFilter === "published") conditions.push(eq(posts.published, true));
  if (statusFilter === "draft") conditions.push(eq(posts.published, false));

  const orderBy =
    sortCol === "title"
      ? sortDir === "asc" ? asc(posts.title) : desc(posts.title)
      : sortDir === "asc" ? asc(posts.createdAt) : desc(posts.createdAt);

  const allPosts = await db
    .select()
    .from(posts)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(orderBy);

  const th = "text-left px-4 py-2.5 text-xs font-medium text-zinc-400 uppercase tracking-wide";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">Posts &amp; Pages</h1>
        <Link
          href="/admin/posts/new"
          className="bg-[var(--ds-blue-1000)] text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-[var(--ds-blue-900)] transition-colors"
        >
          + New
        </Link>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500 font-medium mr-1">Type:</span>
          <FilterPill href={buildUrl(sp, { type: "" })} active={!typeFilter}>All</FilterPill>
          <FilterPill href={buildUrl(sp, { type: "post" })} active={typeFilter === "post"}>Posts</FilterPill>
          <FilterPill href={buildUrl(sp, { type: "page" })} active={typeFilter === "page"}>Pages</FilterPill>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-500 font-medium mr-1">Status:</span>
          <FilterPill href={buildUrl(sp, { status: "" })} active={!statusFilter}>All</FilterPill>
          <FilterPill href={buildUrl(sp, { status: "published" })} active={statusFilter === "published"}>Published</FilterPill>
          <FilterPill href={buildUrl(sp, { status: "draft" })} active={statusFilter === "draft"}>Draft</FilterPill>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100">
              <th className={th}>
                <Link href={sortHref(sp, "title")} className="hover:text-zinc-700 inline-flex items-center">
                  Title <SortIcon current={sp} col="title" />
                </Link>
              </th>
              <th className={th}>Type</th>
              <th className={`${th} hidden md:table-cell`}>AEO</th>
              <th className={th}>Status</th>
              <th className={th}>
                <Link href={sortHref(sp, "date")} className="hover:text-zinc-700 inline-flex items-center">
                  Date <SortIcon current={sp} col="date" />
                </Link>
              </th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {allPosts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-400">
                  No results. Try adjusting the filters.
                </td>
              </tr>
            ) : (
              allPosts.map(post => (
                <tr key={post.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-zinc-900">{post.title}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      post.type === "page" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                    }`}>
                      {post.type === "page" ? "Page" : "Post"}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {(() => {
                      const { score, dots } = calcAeoScore(parseAeoMetadata(post.aeoMetadata));
                      return (
                        <div
                          className="flex items-center gap-1"
                          title={`AEO: ${score}/3 (summary · Q&A · entities)`}
                        >
                          {dots.map((filled, i) => (
                            <span key={i} className={`w-2 h-2 rounded-full ${filled ? "bg-green-500" : "bg-zinc-200"}`} />
                          ))}
                          {score === 3 && (
                            <span className="text-xs text-green-600 font-medium ml-0.5">Complete</span>
                          )}
                          {score === 0 && (
                            <span className="text-xs text-zinc-400 ml-0.5">None</span>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    {post.published ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Published</span>
                    ) : post.publishedAt && post.publishedAt > new Date() ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
                        Scheduled {post.publishedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 text-zinc-600">Draft</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs">
                    {new Date(post.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <Link href={`/admin/posts/${post.id}/edit`} className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors">Edit</Link>
                      {post.published && (
                        <Link href={`/post/${post.slug}`} target="_blank" className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors">View</Link>
                      )}
                      <DeletePostButton id={post.id} title={post.title} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
