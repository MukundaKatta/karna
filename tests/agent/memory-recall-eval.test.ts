// ─── Memory Recall Eval Tests (Issue #541) ───────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  evaluateRecall,
  recallAtK,
  type RecallCase,
  type RetrieveFn,
} from "../../agent/src/memory/recall-eval.js";

// Fixture: query string -> ranked retrieved ids.
const RANKED: Record<string, string[]> = {
  q1: ["a", "b", "c", "d"],
  q2: ["x", "y", "z"],
  q3: ["p", "q", "r"],
};

const retrieve: RetrieveFn = (query, k) => (RANKED[query as string] ?? []).slice(0, k);

const cases: RecallCase[] = [
  { id: "q1", query: "q1", relevantIds: ["a", "c"] }, // ranks 1,3
  { id: "q2", query: "q2", relevantIds: ["z"] }, // rank 3
  { id: "q3", query: "q3", relevantIds: ["nope"] }, // miss
];

describe("evaluateRecall", () => {
  it("computes recall, precision, hit-rate and MRR", async () => {
    const report = await evaluateRecall(cases, retrieve, { ks: [1, 3] });
    expect(report.total).toBe(3);

    // recall@3: q1 = 2/2=1, q2 = 1/1=1, q3 = 0/1=0 -> mean = 2/3
    expect(report.aggregates[3].recallAtK).toBeCloseTo(2 / 3, 6);
    // recall@1: q1 has "a" at rank1 => 1/2=0.5; q2 none@1=0; q3=0 -> (0.5)/3
    expect(report.aggregates[1].recallAtK).toBeCloseTo(0.5 / 3, 6);

    // hit-rate@3: q1 hit, q2 hit, q3 miss -> 2/3
    expect(report.aggregates[3].hitRateAtK).toBeCloseTo(2 / 3, 6);

    // MRR: q1 first relevant rank 1 -> 1; q2 rank 3 -> 1/3; q3 -> 0
    expect(report.mrr).toBeCloseTo((1 + 1 / 3 + 0) / 3, 6);
  });

  it("precision@1 reflects top result correctness", async () => {
    const report = await evaluateRecall(cases, retrieve, { ks: [1] });
    // q1 top is "a" (relevant)=1; q2 top "x" (not)=0; q3=0 -> 1/3
    expect(report.aggregates[1].precisionAtK).toBeCloseTo(1 / 3, 6);
  });

  it("per-case results expose retrieved list and metrics", async () => {
    const report = await evaluateRecall(cases, retrieve, { ks: [3] });
    const q1 = report.cases.find((c) => c.id === "q1");
    expect(q1?.retrieved).toEqual(["a", "b", "c"]);
    expect(q1?.byK[3].firstRelevantRank).toBe(1);
    expect(q1?.byK[3].reciprocalRank).toBeCloseTo(1, 6);
  });

  it("calls retrieve once per case at max k", async () => {
    let calls = 0;
    const counting: RetrieveFn = (q, k) => {
      calls++;
      expect(k).toBe(5); // max of ks
      return retrieve(q, k);
    };
    await evaluateRecall(cases, counting, { ks: [1, 3, 5] });
    expect(calls).toBe(3);
  });

  it("handles empty fixtures", async () => {
    const report = await evaluateRecall([], retrieve, { ks: [3] });
    expect(report.total).toBe(0);
    expect(report.mrr).toBe(0);
    expect(report.aggregates[3].recallAtK).toBe(0);
  });

  it("recallAtK convenience matches full report", async () => {
    const r = await recallAtK(cases, retrieve, 3);
    expect(r).toBeCloseTo(2 / 3, 6);
  });

  it("supports async retrieve fn", async () => {
    const asyncRetrieve: RetrieveFn = async (q, k) => retrieve(q, k);
    const report = await evaluateRecall(cases, asyncRetrieve, { ks: [3] });
    expect(report.aggregates[3].recallAtK).toBeCloseTo(2 / 3, 6);
  });
});
