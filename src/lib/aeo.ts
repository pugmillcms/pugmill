import { z } from "zod";

/**
 * Zod schema for AEO (Answer Engine Optimisation) metadata stored in the
 * aeo_metadata JSONB column. Single source of truth used by:
 *   - Server actions (write path validation)
 *   - Site pages, llms.txt routes (read path validation)
 */
export const aeoSchema = z.object({
  summary: z.string().max(2000).optional(),
  questions: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  entities: z.array(z.object({
    type: z.string(),
    name: z.string(),
    description: z.string().optional(),
  })).optional(),
  keywords: z.array(z.string()).max(10).optional(),
}).optional();

export type AeoMetadata = NonNullable<z.infer<typeof aeoSchema>>;

/**
 * Compute a 0–3 AEO completeness score for a post.
 * Criteria: summary filled (1), at least one Q&A pair (1), at least one entity (1).
 */
export function calcAeoScore(aeo: AeoMetadata | null): { score: number; dots: boolean[] } {
  if (!aeo) return { score: 0, dots: [false, false, false] };
  const hasSummary  = !!aeo.summary?.trim();
  const hasQa       = (aeo.questions ?? []).some(q => q.q && q.a);
  const hasEntities = (aeo.entities  ?? []).some(e => e.name);
  const dots = [hasSummary, hasQa, hasEntities];
  return { score: dots.filter(Boolean).length, dots };
}

/**
 * Safely parse the aeo_metadata JSONB value from the database.
 * If strict schema validation fails, attempts a lenient partial parse so that
 * valid fields (summary, questions, entities) still contribute to the AEO score
 * even if one field (e.g. an over-length keyword) would otherwise fail.
 */
export function parseAeoMetadata(raw: unknown): AeoMetadata | null {
  if (raw == null) return null;
  const value = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const result = aeoSchema.safeParse(value);
  if (result.success && result.data != null) return result.data;
  // Fallback: lenient partial parse — extract known-good fields individually
  const v = value as Record<string, unknown>;
  const partial: AeoMetadata = {};
  if (typeof v.summary === "string") partial.summary = v.summary.slice(0, 2000);
  if (Array.isArray(v.questions)) {
    const qs = (v.questions as unknown[]).filter(
      (q): q is { q: string; a: string } =>
        typeof (q as Record<string, unknown>).q === "string" &&
        typeof (q as Record<string, unknown>).a === "string",
    );
    if (qs.length > 0) partial.questions = qs;
  }
  if (Array.isArray(v.entities)) {
    const es = (v.entities as unknown[]).filter(
      (e): e is { type: string; name: string; description?: string } =>
        typeof (e as Record<string, unknown>).name === "string",
    );
    if (es.length > 0) partial.entities = es as AeoMetadata["entities"];
  }
  if (Array.isArray(v.keywords)) {
    const kws = (v.keywords as unknown[]).filter((k): k is string => typeof k === "string").slice(0, 10);
    if (kws.length > 0) partial.keywords = kws;
  }
  return Object.keys(partial).length > 0 ? partial : null;
}
