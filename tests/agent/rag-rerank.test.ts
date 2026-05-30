import { describe, it, expect } from "vitest";
import {
  HeuristicReranker,
  ModelReranker,
  lexicalScore,
  rerank,
  type CrossScoreFn,
} from "../../agent/src/rag/rerank.js";
import type { RetrievalResult } from "../../agent/src/rag/retriever.js";

function rr(id: string, content: string, score: number): RetrievalResult {
  return { id, content, score, source: "vector" };
}

describe("lexicalScore", () => {
  it("is 1 when all query terms are covered", () => {
    expect(lexicalScore("cat dog", "the cat and dog play")).toBeGreaterThanOrEqual(1);
  });
  it("is 0 with no overlap", () => {
    expect(lexicalScore("zebra", "cat dog")).toBe(0);
  });
  it("returns 0 for an empty query", () => {
    expect(lexicalScore("", "anything")).toBe(0);
  });
});

describe("HeuristicReranker", () => {
  it("reorders candidates by blended score", async () => {
    const reranker = new HeuristicReranker({ retrievalWeight: 0.2 });
    const candidates = [
      rr("a", "completely unrelated marine biology text", 0.9),
      rr("b", "the quantum computer runs fast", 0.4),
    ];
    const out = await reranker.rerank("quantum computer", candidates);
    expect(out[0].id).toBe("b");
    expect(out[0].originalScore).toBe(0.4);
    expect(out[0].rerankScore).toBe(out[0].score);
  });

  it("respects topK", async () => {
    const out = await rerank("x", [rr("a", "x", 0.5), rr("b", "x", 0.4), rr("c", "x", 0.3)], 2);
    expect(out).toHaveLength(2);
  });

  it("preserves order when retrievalWeight is 1 and scores dominate", async () => {
    const reranker = new HeuristicReranker({ retrievalWeight: 1 });
    const out = await reranker.rerank("foo", [rr("a", "no match", 0.9), rr("b", "no match", 0.1)]);
    expect(out[0].id).toBe("a");
  });
});

describe("ModelReranker", () => {
  it("uses the injected scoring function", async () => {
    const scoreFn: CrossScoreFn = async (_q, cands) => cands.map((c) => (c.id === "b" ? 10 : 1));
    const out = await new ModelReranker(scoreFn).rerank("q", [rr("a", "a", 0.9), rr("b", "b", 0.1)]);
    expect(out[0].id).toBe("b");
    expect(out[0].rerankScore).toBe(10);
  });

  it("falls back to the original score for non-finite values", async () => {
    const scoreFn: CrossScoreFn = async () => [NaN];
    const out = await new ModelReranker(scoreFn).rerank("q", [rr("a", "a", 0.7)]);
    expect(out[0].rerankScore).toBe(0.7);
  });

  it("returns empty for an empty candidate list", async () => {
    expect(await new ModelReranker(async () => []).rerank("q", [])).toEqual([]);
  });
});
