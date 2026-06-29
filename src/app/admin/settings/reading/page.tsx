import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reading" };

import { db } from "@/lib/db";
import { posts } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { getConfig, updateConfig } from "@/lib/config";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PageShell, SaveButton } from "../_components";

export default async function ReadingSettingsPage({ searchParams }: { searchParams: Promise<{ toast?: string }> }) {
  const [config, sp, pages] = await Promise.all([
    getConfig(),
    searchParams,
    db
      .select({ id: posts.id, title: posts.title, slug: posts.slug })
      .from(posts)
      .where(and(eq(posts.type, "page"), eq(posts.published, true)))
      .orderBy(desc(posts.createdAt)),
  ]);
  const saved = sp.toast === "saved";
  const reading = config.reading ?? { homepageMode: "sections" as const, homepagePageId: null };

  async function saveReading(formData: FormData) {
    "use server";
    const current = await getConfig();
    const mode = formData.get("homepageMode") === "page" ? "page" : "sections";
    const rawId = formData.get("homepagePageId");
    const parsedId = rawId ? parseInt(rawId as string, 10) : NaN;
    const homepagePageId = mode === "page" && Number.isInteger(parsedId) ? parsedId : null;

    await updateConfig({
      ...current,
      reading: { homepageMode: mode, homepagePageId },
    });

    revalidatePath("/", "layout");
    revalidatePath("/admin/settings/reading");
    redirect("/admin/settings/reading?toast=saved");
  }

  return (
    <PageShell
      title="Reading"
      description="Choose what visitors see on your homepage."
      saved={saved}
    >
      <form action={saveReading}>
        <section className="bg-white border border-zinc-200 rounded-lg p-6 space-y-5">
          <div>
            <p className="text-sm font-medium text-zinc-700 mb-2">Your homepage displays</p>
            <label className="flex items-start gap-2 mb-3">
              <input
                type="radio"
                name="homepageMode"
                value="sections"
                defaultChecked={reading.homepageMode !== "page"}
                className="mt-1"
              />
              <span className="text-sm text-zinc-700">
                <span className="font-medium">Theme homepage</span>
                <span className="block text-xs text-zinc-500">
                  The active theme&apos;s configured homepage sections (default).
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="homepageMode"
                value="page"
                defaultChecked={reading.homepageMode === "page"}
                className="mt-1"
              />
              <span className="text-sm text-zinc-700">
                <span className="font-medium">A static page</span>
                <span className="block text-xs text-zinc-500">
                  Use one of your published pages as the front page.
                </span>
              </span>
            </label>
          </div>

          <div>
            <label htmlFor="homepagePageId" className="block text-sm font-medium text-zinc-700 mb-1">
              Homepage
            </label>
            <select
              id="homepagePageId"
              name="homepagePageId"
              defaultValue={reading.homepagePageId ?? ""}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
            >
              <option value="">— Select a page —</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} (/{p.slug})
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-400 mt-1">
              Only applies when “A static page” is selected. If the chosen page is later unpublished or
              deleted, the site falls back to the theme homepage.
            </p>
          </div>

          <SaveButton />
        </section>
      </form>
    </PageShell>
  );
}
