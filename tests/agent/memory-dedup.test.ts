// ─── Memory Dedup Tests (Issue #536) ─────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  cosineDistance,
  findBestMatch,
  isDuplicate,
  findDuplicateRecord,
  mergeRecords,
  averageEmbeddings,
  dedupeRecords,
  type EmbeddedRecord,
} from "../../agent/src/memory/dedup.js";

function rec(overrides: Partial<EmbeddedRecord> = {}): EmbeddedRecord {
  return { id: "r", ...overrides };
}

describe("dedup.cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("returns 0 for mismatched or empty vectors (never NaN)", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("clamps within [-1, 1] and computes distance", () => {
    expect(cosineDistance([1, 0], [1, 0])).toBeCloseTo(0, 6);
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2, 6);
  });
});

describe("dedup.findBestMatch / isDuplicate", () => {
  it("finds the best match above threshold", () => {
    const existing = [
      rec({ id: "a", embedding: [1, 0, 0] }),
      rec({ id: "b", embedding: [0.6, 0.8, 0] }),
    ];
    const match = findBestMatch([1, 0, 0], existing, 0.9);
    expect(match).not.toBeNull();
    expect(match!.record.id).toBe("a");
    expect(match!.similarity).toBeCloseTo(1, 6);
  });

  it("returns null when nothing exceeds threshold", () => {
    const existing = [rec({ id: "a", embedding: [0, 1, 0] })];
    expect(findBestMatch([1, 0, 0], existing, 0.9)).toBeNull();
    expect(isDuplicate([1, 0, 0], existing, 0.9)).toBe(false);
  });

  it("ignores records without embeddings", () => {
    const existing = [rec({ id: "a" })];
    expect(isDuplicate([1, 0, 0], existing, 0.5)).toBe(false);
  });
});

describe("dedup.findDuplicateRecord", () => {
  it("matches by exact normalized content when embeddings absent", () => {
    const existing = [rec({ id: "a", content: "User likes Tea" })];
    const match = findDuplicateRecord({ content: "  user   likes tea " }, existing);
    expect(match?.record.id).toBe("a");
    expect(match?.similarity).toBe(1);
  });

  it("can disable exact-content matching", () => {
    const existing = [rec({ id: "a", content: "same" })];
    const match = findDuplicateRecord(
      { content: "same" },
      existing,
      { matchExactContent: false },
    );
    expect(match).toBeNull();
  });
});

describe("dedup.mergeRecords / averageEmbeddings", () => {
  it("keeps higher-importance record and unions tags", () => {
    const a = rec({ id: "a", importance: 0.9, content: "primary", tags: ["x"], embedding: [1, 0] });
    const b = rec({ id: "b", importance: 0.2, content: "secondary", tags: ["y"], embedding: [0, 1] });
    const merged = mergeRecords(a, b);
    expect(merged.content).toBe("primary");
    expect(merged.importance).toBe(0.9);
    expect(merged.tags!.sort()).toEqual(["x", "y"]);
    expect(merged.embedding).toEqual([0.5, 0.5]);
  });

  it("averages embeddings or falls back to the present one", () => {
    expect(averageEmbeddings([2, 4], [4, 8])).toEqual([3, 6]);
    expect(averageEmbeddings([1, 2], undefined)).toEqual([1, 2]);
    expect(averageEmbeddings(undefined, undefined)).toBeUndefined();
  });
});

describe("dedup.dedupeRecords", () => {
  it("collapses near-duplicate embeddings into clusters", () => {
    const records: EmbeddedRecord[] = [
      rec({ id: "a", embedding: [1, 0, 0], importance: 0.5 }),
      rec({ id: "b", embedding: [0.999, 0.001, 0], importance: 0.9 }),
      rec({ id: "c", embedding: [0, 1, 0], importance: 0.5 }),
    ];
    const result = dedupeRecords(records, { threshold: 0.95 });
    expect(result.kept).toHaveLength(2);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].id).toBe("b");
  });

  it("keeps everything when nothing matches", () => {
    const records: EmbeddedRecord[] = [
      rec({ id: "a", embedding: [1, 0] }),
      rec({ id: "b", embedding: [0, 1] }),
    ];
    const result = dedupeRecords(records, { threshold: 0.99 });
    expect(result.kept).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });
});
