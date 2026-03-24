import { z } from "zod";

/**
 * Zod schema for AEO (Answer Engine Optimisation) metadata stored in the
 * aeo_metadata JSONB column. Single source of truth used by:
 *   - Server actions (write path validation)
 *   - Site pages, llms.txt routes (read path validation)
 */
export const aeoSchema = z.object({
  summary: z.string().max(1000).optional(),
  questions: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  entities: z.array(z.object({
    type: z.string(),
    name: z.string(),
    description: z.string().optional(),
  })).optional(),
  keywords: z.array(z.string().max(100)).max(30).optional(),
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
 * Returns null if the value is absent, not valid JSON, or fails schema validation.
 */
export function parseAeoMetadata(raw: unknown): AeoMetadata | null {
  if (raw == null) return null;
  const value = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (value == null) return null;
  const result = aeoSchema.safeParse(value);
  return result.success && result.data != null ? result.data : null;
}
