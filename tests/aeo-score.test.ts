/**
 * Unit tests for calcAeoScore and parseAeoMetadata in src/lib/aeo.ts.
 */
import { describe, it, expect } from "vitest";
import { calcAeoScore, parseAeoMetadata } from "@/lib/aeo";

// ─── calcAeoScore ──────────────────────────────────────────────────────────────

describe("calcAeoScore", () => {
  it("returns score 0 and all-false dots for null", () => {
    const { score, dots } = calcAeoScore(null);
    expect(score).toBe(0);
    expect(dots).toEqual([false, false, false]);
  });

  it("returns score 0 for an empty metadata object", () => {
    expect(calcAeoScore({}).score).toBe(0);
  });

  it("awards 1 for a non-empty summary", () => {
    const { score, dots } = calcAeoScore({ summary: "A great post." });
    expect(score).toBe(1);
    expect(dots[0]).toBe(true);
    expect(dots[1]).toBe(false);
    expect(dots[2]).toBe(false);
  });

  it("does not award the summary point for a whitespace-only summary", () => {
    expect(calcAeoScore({ summary: "   " }).dots[0]).toBe(false);
  });

  it("awards 1 for at least one valid Q&A pair", () => {
    const { dots } = calcAeoScore({ questions: [{ q: "What is it?", a: "A thing." }] });
    expect(dots[1]).toBe(true);
  });

  it("does not award the Q&A point when questions array is empty", () => {
    expect(calcAeoScore({ questions: [] }).dots[1]).toBe(false);
  });

  it("does not award the Q&A point when both q and a are empty strings", () => {
    expect(calcAeoScore({ questions: [{ q: "", a: "" }] }).dots[1]).toBe(false);
  });

  it("awards 1 for at least one entity with a name", () => {
    const { dots } = calcAeoScore({ entities: [{ type: "Organization", name: "Acme" }] });
    expect(dots[2]).toBe(true);
  });

  it("does not award the entity point for an entity with an empty name", () => {
    expect(calcAeoScore({ entities: [{ type: "Organization", name: "" }] }).dots[2]).toBe(false);
  });

  it("returns score 3 for fully-complete AEO metadata", () => {
    const { score, dots } = calcAeoScore({
      summary: "A summary.",
      questions: [{ q: "Q?", a: "A." }],
      entities: [{ type: "Person", name: "Alice" }],
    });
    expect(score).toBe(3);
    expect(dots).toEqual([true, true, true]);
  });

  it("returns correct partial score of 2", () => {
    const { score } = calcAeoScore({
      summary: "A summary.",
      questions: [{ q: "Q?", a: "A." }],
    });
    expect(score).toBe(2);
  });
});

// ─── parseAeoMetadata ─────────────────────────────────────────────────────────

describe("parseAeoMetadata", () => {
  it("returns null for null input", () => {
    expect(parseAeoMetadata(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseAeoMetadata(undefined)).toBeNull();
  });

  it("parses a valid JSON string", () => {
    const raw = JSON.stringify({ summary: "Hello." });
    const result = parseAeoMetadata(raw);
    expect(result?.summary).toBe("Hello.");
  });

  it("parses a plain object directly", () => {
    const result = parseAeoMetadata({ summary: "Direct." });
    expect(result?.summary).toBe("Direct.");
  });

  it("returns null for a malformed JSON string", () => {
    expect(parseAeoMetadata("{bad json")).toBeNull();
  });

  it("returns null for a string that is not an object (e.g. a number)", () => {
    expect(parseAeoMetadata("42")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseAeoMetadata("")).toBeNull();
  });

  it("accepts metadata with no fields (fully optional schema)", () => {
    expect(parseAeoMetadata({})).not.toBeNull();
  });

  it("rejects a summary that exceeds 1000 characters", () => {
    const result = parseAeoMetadata({ summary: "x".repeat(1001) });
    expect(result).toBeNull();
  });

  it("ignores unknown extra fields without failing", () => {
    const result = parseAeoMetadata({ summary: "Ok.", unknownField: true });
    expect(result?.summary).toBe("Ok.");
  });
});
