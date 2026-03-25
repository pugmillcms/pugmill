import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";
import MediaUploadForm from "./MediaUploadForm";
import MediaDeleteButton from "./MediaDeleteButton";
import Image from "next/image";

const PAGE_SIZE = 50;

export default async function MediaPage() {
  const [allMedia, [{ total }], usedRows] = await Promise.all([
    db.select().from(media).orderBy(desc(media.createdAt)).limit(PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(media),
    // IDs referenced as a featured image OR embedded in any post's content body
    db.execute(sql`
      SELECT DISTINCT m.id
      FROM media m
      INNER JOIN posts p
        ON p.featured_image = m.id
        OR p.content ILIKE '%' || m.url || '%'
    `),
  ]);

  const usedIds = new Set(usedRows.rows.map((r) => (r as { id: number }).id));

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-zinc-900">Media Library</h1>
        {total > PAGE_SIZE && (
          <p className="text-sm text-zinc-400">Showing {PAGE_SIZE} of {total} items</p>
        )}
      </div>
      <MediaUploadForm />
      {allMedia.length === 0 && (
        <p className="text-zinc-400 text-sm text-center py-12">
          No media uploaded yet.
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {allMedia.map((item) => (
          <div key={item.id} className="bg-white border border-zinc-200 rounded-lg overflow-hidden group relative">
            {item.fileType?.startsWith("image/") ? (
              <div className="relative aspect-square bg-zinc-100">
                <Image
                  src={item.url}
                  alt={item.altText || item.fileName}
                  fill
                  className="object-cover"
                />
                {!usedIds.has(item.id) && (
                  <span className="absolute top-1.5 left-1.5 bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                    Unused
                  </span>
                )}
              </div>
            ) : (
              <div className="aspect-square bg-zinc-100 flex items-center justify-center text-zinc-400 text-sm relative">
                {item.fileType}
                {!usedIds.has(item.id) && (
                  <span className="absolute top-1.5 left-1.5 bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                    Unused
                  </span>
                )}
              </div>
            )}
            <div className="p-2 flex items-start justify-between gap-1">
              <div className="min-w-0">
                <p className="text-xs text-zinc-600 truncate">{item.fileName}</p>
                {item.fileSize && (
                  <p className="text-xs text-zinc-400">
                    {(item.fileSize / 1024).toFixed(0)} KB
                  </p>
                )}
              </div>
              <MediaDeleteButton id={item.id} fileName={item.fileName} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
