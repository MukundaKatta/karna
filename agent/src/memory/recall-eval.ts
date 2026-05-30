// ─── Memory Recall Evaluation Harness ──────────────────────────────────────
// Issue #541 — Offline quality metrics for memory retrieval.
//
// Given a labeled fixture set (queries + their relevant memory ids) and a
// retrieve fn, compute standard IR metrics: recall@k, precision@k, MRR, and
// hit-rate. Pure & dependency-free; the retrieve fn is injected so this works
// against any backend (real store, mock, or a ranked list).
//
// Additive & non-breaking: nothing runs unless invoked.

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single labeled evaluation case. */
export interface RecallCase {
  /** Stable id for reporting per-case results. */
  id: string;
  /** The query text/embedding payload passed to the retrieve fn (opaque). */
  query: unknown;
  /** Ids of memories considered relevant (the ground truth). */
  relevantIds: string[];
}

/**
 * Retrieve fn under test: given a query and a result cap `k`, return an ordered
 * list of memory ids (best first). May be async.
 */
export type RetrieveFn = (query: unknown, k: number) => Promise<string[]> | string[];

export interface RecallEvalOptions {
  /** Cutoffs to evaluate. Default: [1, 3, 5, 10]. */
  ks?: number[];
}

/** Metrics for a single case at one cutoff k. */
export interface CaseMetrics {
  recall: number;
  precision: number;
  /** First relevant rank (1-based), or 0 if none retrieved within k. */
  firstRelevantRank: number;
  /** Reciprocal rank = 1/firstRelevantRank, or 0. */
  reciprocalRank: number;
  hit: boolean;
}

export interface CaseResult {
  id: string;
  /** Retrieved ids (truncated to max k). */
  retrieved: string[];
  /** Metrics keyed by cutoff k. */
  byK: Record<number, CaseMetrics>;
}

/** Aggregate metrics at a single cutoff. */
export interface AggregateAtK {
  k: number;
  recallAtK: number;
  precisionAtK: number;
  hitRateAtK: number;
}

export interface RecallEvalReport {
  cases: CaseResult[];
  /** Mean Reciprocal Rank across all cases (uses the largest k as the window). */
  mrr: number;
  /** Aggregate metrics keyed by cutoff k. */
  aggregates: Record<number, AggregateAtK>;
  /** Number of cases evaluated. */
  total: number;
}

// ─── Metric Computation ─────────────────────────────────────────────────────

function metricsAtK(retrieved: string[], relevant: Set<string>, k: number): CaseMetrics {
  const topK = retrieved.slice(0, k);
  let hits = 0;
  let firstRank = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevant.has(topK[i])) {
      hits++;
      if (firstRank === 0) firstRank = i + 1;
    }
  }
  const recall = relevant.size > 0 ? hits / relevant.size : 0;
  const precision = topK.length > 0 ? hits / topK.length : 0;
  return {
    recall,
    precision,
    firstRelevantRank: firstRank,
    reciprocalRank: firstRank > 0 ? 1 / firstRank : 0,
    hit: hits > 0,
  };
}

/**
 * Evaluate a retrieve fn against a labeled fixture set. Retrieves once per case
 * at the maximum cutoff, then derives every smaller-k metric from that single
 * ranked list (so the retrieve fn is called exactly once per case).
 */
export async function evaluateRecall(
  cases: RecallCase[],
  retrieve: RetrieveFn,
  options?: RecallEvalOptions,
): Promise<RecallEvalReport> {
  const ks = (options?.ks ?? [1, 3, 5, 10]).filter((k) => k > 0).sort((a, b) => a - b);
  const maxK = ks.length > 0 ? ks[ks.length - 1] : 10;

  const caseResults: CaseResult[] = [];
  // Accumulators for aggregates.
  const recallSum: Record<number, number> = {};
  const precisionSum: Record<number, number> = {};
  const hitSum: Record<number, number> = {};
  for (const k of ks) {
    recallSum[k] = 0;
    precisionSum[k] = 0;
    hitSum[k] = 0;
  }
  let rrSum = 0;

  for (const c of cases) {
    const retrieved = (await retrieve(c.query, maxK)).slice(0, maxK);
    const relevant = new Set(c.relevantIds);

    const byK: Record<number, CaseMetrics> = {};
    for (const k of ks) {
      const m = metricsAtK(retrieved, relevant, k);
      byK[k] = m;
      recallSum[k] += m.recall;
      precisionSum[k] += m.precision;
      hitSum[k] += m.hit ? 1 : 0;
    }

    // MRR uses the full retrieved window (up to maxK).
    rrSum += metricsAtK(retrieved, relevant, maxK).reciprocalRank;

    caseResults.push({ id: c.id, retrieved, byK });
  }

  const total = cases.length;
  const aggregates: Record<number, AggregateAtK> = {};
  for (const k of ks) {
    aggregates[k] = {
      k,
      recallAtK: total > 0 ? recallSum[k] / total : 0,
      precisionAtK: total > 0 ? precisionSum[k] / total : 0,
      hitRateAtK: total > 0 ? hitSum[k] / total : 0,
    };
  }

  return {
    cases: caseResults,
    mrr: total > 0 ? rrSum / total : 0,
    aggregates,
    total,
  };
}

/** Convenience: recall@k aggregate for a fixture set (single number). */
export async function recallAtK(
  cases: RecallCase[],
  retrieve: RetrieveFn,
  k: number,
): Promise<number> {
  const report = await evaluateRecall(cases, retrieve, { ks: [k] });
  return report.aggregates[k]?.recallAtK ?? 0;
}
