// ─── Latency & Cost Benchmark (#573) ──────────────────────────────────────────
//
// Measure per-run latency (time-to-first-token and total) and cost, aggregate
// the distribution, and detect regressions against a saved baseline.
//
// Cost is computed via @karna/shared's `calculateCost`, which returns a
// CostBreakdown object (NOT a number) — we read `.totalCost` off it.
//
// ──────────────────────────────────────────────────────────────────────────────

import { calculateCost, type TokenUsage } from "@karna/shared";

/** The result of one measured run. */
export interface RunMeasurement {
  /** Time-to-first-token in milliseconds. */
  ttftMs: number;
  /** Total wall-clock latency in milliseconds. */
  totalMs: number;
  /** Token usage for cost computation. */
  usage: TokenUsage;
}

/**
 * The system under test for a single input. Returns timing + usage. Injected so
 * the benchmark is deterministic in tests (no real clock/model needed).
 */
export type MeasuredRunner<TInput> = (
  input: TInput,
) => RunMeasurement | Promise<RunMeasurement>;

/** A single benchmark case. */
export interface LatencyCostCase<TInput> {
  id: string;
  input: TInput;
  model: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Per-case measured result, with cost resolved. */
export interface CaseResult {
  caseId: string;
  model: string;
  ttftMs: number;
  totalMs: number;
  costUsd: number;
  error?: string;
}

/** A baseline snapshot, persistable to disk and compared against later. */
export interface Baseline {
  meanTtftMs: number;
  p95TtftMs: number;
  meanTotalMs: number;
  p95TotalMs: number;
  totalCostUsd: number;
}

/** Aggregate latency/cost report (also serves as a {@link Baseline} superset). */
export interface LatencyCostReport extends Baseline {
  name: string;
  total: number;
  results: CaseResult[];
}

/**
 * Run a latency/cost benchmark. Each case is measured via the injected runner;
 * cost is derived from token usage using shared pricing.
 */
export async function runLatencyCostBench<TInput>(
  name: string,
  cases: ReadonlyArray<LatencyCostCase<TInput>>,
  runner: MeasuredRunner<TInput>,
): Promise<LatencyCostReport> {
  const results: CaseResult[] = [];

  for (const c of cases) {
    try {
      const m = await runner(c.input);
      let costUsd = 0;
      try {
        costUsd = calculateCost(c.model, m.usage).totalCost;
      } catch {
        // Unknown model pricing: leave cost at 0 but keep the timing data.
        costUsd = 0;
      }
      results.push({
        caseId: c.id,
        model: c.model,
        ttftMs: m.ttftMs,
        totalMs: m.totalMs,
        costUsd,
      });
    } catch (err) {
      results.push({
        caseId: c.id,
        model: c.model,
        ttftMs: 0,
        totalMs: 0,
        costUsd: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ttfts = results.map((r) => r.ttftMs).sort((a, b) => a - b);
  const totals = results.map((r) => r.totalMs).sort((a, b) => a - b);
  const totalCostUsd = results.reduce((a, r) => a + r.costUsd, 0);

  return {
    name,
    total: results.length,
    meanTtftMs: mean(ttfts),
    p95TtftMs: percentile(ttfts, 95),
    meanTotalMs: mean(totals),
    p95TotalMs: percentile(totals, 95),
    totalCostUsd,
    results,
  };
}

/** Extract a {@link Baseline} from a report (e.g. to persist for next time). */
export function toBaseline(report: LatencyCostReport): Baseline {
  return {
    meanTtftMs: report.meanTtftMs,
    p95TtftMs: report.p95TtftMs,
    meanTotalMs: report.meanTotalMs,
    p95TotalMs: report.p95TotalMs,
    totalCostUsd: report.totalCostUsd,
  };
}

/** A single detected regression in a tracked metric. */
export interface Regression {
  metric: keyof Baseline;
  baseline: number;
  current: number;
  /** Relative increase, e.g. 0.25 == 25% worse than baseline. */
  ratio: number;
}

/** Result of a regression check. */
export interface RegressionReport {
  regressed: boolean;
  /** Allowed relative increase before flagging (e.g. 0.1 == 10%). */
  tolerance: number;
  regressions: Regression[];
}

const TRACKED_METRICS: (keyof Baseline)[] = [
  "meanTtftMs",
  "p95TtftMs",
  "meanTotalMs",
  "p95TotalMs",
  "totalCostUsd",
];

/**
 * Compare a current report against a baseline. A metric regresses when it
 * exceeds the baseline by more than `tolerance` (relative). For baseline values
 * of 0, any positive current value above an absolute epsilon counts as a
 * regression.
 *
 * @param tolerance Relative slack, default 0.10 (10%).
 */
export function detectRegression(
  baseline: Baseline,
  current: Baseline,
  tolerance = 0.1,
): RegressionReport {
  const regressions: Regression[] = [];
  for (const metric of TRACKED_METRICS) {
    const b = baseline[metric];
    const c = current[metric];
    if (b <= 0) {
      if (c > 1e-9) {
        regressions.push({ metric, baseline: b, current: c, ratio: Infinity });
      }
      continue;
    }
    const ratio = (c - b) / b;
    if (ratio > tolerance) {
      regressions.push({ metric, baseline: b, current: c, ratio });
    }
  }
  return {
    regressed: regressions.length > 0,
    tolerance,
    regressions,
  };
}
