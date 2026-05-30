// ─── Memory Scoring Tests ────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  scoreImportance,
  applyDecay,
  recencyScore,
  rankMemories,
} from "../../agent/src/memory/scoring.js";
import type { MemoryEntry, MemoryPriority } from "@karna/shared/types/memory.js";

const NOW = 10_000_000;
const DAY = 24 * 60 * 60 * 1000;

function makeEntry(overrides: Partial<MemoryEntry> & { id: string }): MemoryEntry {
  return {
    content: "c",
    source: "conversation",
    priority: "normal" as MemoryPriority,
    tags: [],
    relatedMessageIds: [],
    relatedMemoryIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    accessedAt: NOW,
    accessCount: 0,
    decayFactor: 1,
    ...overrides,
  };
}

describe("scoring.scoreImportance", () => {
  it("ranks higher priority above lower priority", () => {
    const high = scoreImportance(makeEntry({ id: "h", priority: "critical" }));
    const low = scoreImportance(makeEntry({ id: "l", priority: "low" }));
    expect(high).toBeGreaterThan(low);
  });

  it("rewards access frequency", () => {
    const accessed = scoreImportance(makeEntry({ id: "a", accessCount: 20 }));
    const unaccessed = scoreImportance(makeEntry({ id: "b", accessCount: 0 }));
    expect(accessed).toBeGreaterThan(unaccessed);
  });

  it("stays within [0,1]", () => {
    const s = scoreImportance(
      makeEntry({ id: "x", priority: "critical", accessCount: 1000, content: "x".repeat(2000) }),
    );
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("scoring.applyDecay", () => {
  it("halves the score after one half-life", () => {
    expect(applyDecay(1, DAY, DAY)).toBeCloseTo(0.5, 6);
  });

  it("is unchanged at age 0", () => {
    expect(applyDecay(0.8, 0, DAY)).toBeCloseTo(0.8, 6);
  });

  it("never decays with non-positive half-life", () => {
    expect(applyDecay(0.8, 5 * DAY, 0)).toBe(0.8);
  });

  it("clamps negative age to zero", () => {
    expect(applyDecay(1, -1000, DAY)).toBeCloseTo(1, 6);
  });

  it("recencyScore maps age to (0,1]", () => {
    expect(recencyScore(0, DAY)).toBeCloseTo(1, 6);
    expect(recencyScore(DAY, DAY)).toBeCloseTo(0.5, 6);
  });
});

describe("scoring.rankMemories", () => {
  it("ranks recent + important memories first", () => {
    const memories = [
      makeEntry({ id: "old-low", createdAt: NOW - 30 * DAY, priority: "low" }),
      makeEntry({ id: "new-high", createdAt: NOW - 1000, priority: "critical" }),
    ];
    const ranked = rankMemories(memories, { now: NOW });
    expect(ranked[0].memory.id).toBe("new-high");
  });

  it("uses similarity when a query embedding is provided", () => {
    const memories = [
      makeEntry({ id: "match", embedding: [1, 0, 0] }),
      makeEntry({ id: "nomatch", embedding: [0, 1, 0] }),
    ];
    const ranked = rankMemories(memories, {
      now: NOW,
      queryEmbedding: [1, 0, 0],
      weights: { recency: 0, importance: 0, similarity: 1 },
    });
    expect(ranked[0].memory.id).toBe("match");
    expect(ranked[0].components.similarity).toBeGreaterThan(ranked[1].components.similarity);
  });

  it("drops similarity weight gracefully when no query is given", () => {
    const memories = [makeEntry({ id: "a", priority: "high" })];
    const ranked = rankMemories(memories, {
      now: NOW,
      weights: { recency: 0.5, importance: 0.5, similarity: 0.5 },
    });
    expect(ranked[0].components.similarity).toBe(0);
    expect(ranked[0].score).toBeGreaterThan(0);
    expect(ranked[0].score).toBeLessThanOrEqual(1);
  });

  it("does not mutate the input array", () => {
    const memories = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
    const copy = [...memories];
    rankMemories(memories, { now: NOW });
    expect(memories).toEqual(copy);
  });
});
