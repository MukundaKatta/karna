// ─── Model Routing A/B Eval (#572) ────────────────────────────────────────────
//
// Run the same eval suite across N model configurations and produce a
// comparative table of quality / latency / cost, plus a recommendation that
// balances the three via a configurable weighting.
//
// The per-config runner is injected so this stays deterministic + offline.
//
// ──────────────────────────────────────────────────────────────────────────────

import { runSuite, type Suite } from "./framework.js";
import { calculateCost, type TokenUsage } from "@karna/shared";

/** A model configuration variant in the A/B test. */
export interface ModelVariant {
  /** Stable label for the variant (e.g. "sonnet", "haiku"). */
  label: string;
  /** Model identifier used for cost lookup. */
  model: string;
}

/** What a variant runner returns for a single task: output + perf telemetry. */
export interface VariantRunResult<TOutput> {
  output: TOutput;
  latencyMs: number;
  usage: TokenUsage;
}

/**
 * Runs a single task under a specific variant. Injected. Returns the output
 * (scored by the suite's scorers) plus latency & token usage.
 */
export type VariantRunner<TInput, TOutput> = (
  variant: ModelVariant,
  input: TInput,
) => VariantRunResult<TOutput> | Promise<VariantRunResult<TOutput>>;

/** Aggregated metrics for one variant. */
export interface VariantMetrics {
  label: string;
  model: string;
  /** Mean suite score in [0,1] (quality). */
  quality: number;
  /** Task pass rate in [0,1]. */
  passRate: number;
  /** Mean per-task latency in ms. */
  meanLatencyMs: number;
  /** Total cost across the suite in USD. */
  totalCostUsd: number;
}

/** Weights for the recommendation scalarization. */
export interface RoutingWeights {
  /** Weight on quality (higher is better). Default 1. */
  quality?: number;
  /** Weight penalizing latency (normalized). Default 0.25. */
  latency?: number;
  /** Weight penalizing cost (normalized). Default 0.25. */
  cost?: number;
}

/** The full A/B comparison report. */
export interface RoutingAbReport {
  suite: string;
  variants: VariantMetrics[];
  /** Label of the recommended variant. */
  recommendation: string;
  /** Composite score per variant label (higher is better). */
  compositeScores: Record<string, number>;
  rationale: string;
}

function normalize(values: number[]): number[] {
  const max = Math.max(...values, 0);
  if (max <= 0) return values.map(() => 0);
  return values.map((v) => v / max);
}

/**
 * Run a routing A/B eval. The provided `suite` defines the dataset + scorers;
 * each variant runs the whole suite through `variantRunner`, and we collect
 * quality (mean score), latency, and cost per variant, then recommend one.
 */
export async function runRoutingAb<TInput, TExpected, TOutput>(
  suite: Suite<TInput, TExpected, TOutput>,
  variants: ReadonlyArray<ModelVariant>,
  variantRunner: VariantRunner<TInput, TOutput>,
  weights: RoutingWeights = {},
): Promise<RoutingAbReport> {
  const metrics: VariantMetrics[] = [];

  for (const variant of variants) {
    // Telemetry is collected via a side-channel map keyed by task id, since the
    // suite runner only forwards the output.
    const telemetry = new Map<string, { latencyMs: number; usage: TokenUsage }>();

    const report = await runSuite(suite, async (input, task) => {
      const res = await variantRunner(variant, input);
      telemetry.set(task.id, { latencyMs: res.latencyMs, usage: res.usage });
      return res.output;
    });

    let totalLatency = 0;
    let totalCost = 0;
    for (const t of telemetry.values()) {
      totalLatency += t.latencyMs;
      try {
        totalCost += calculateCost(variant.model, t.usage).totalCost;
      } catch {
        // Unknown model pricing → 0 cost contribution.
      }
    }
    const n = telemetry.size || 1;

    metrics.push({
      label: variant.label,
      model: variant.model,
      quality: report.meanScore,
      passRate: report.passRate,
      meanLatencyMs: totalLatency / n,
      totalCostUsd: totalCost,
    });
  }

  // Scalarize into a composite score: reward quality, penalize normalized
  // latency & cost.
  const wQuality = weights.quality ?? 1;
  const wLatency = weights.latency ?? 0.25;
  const wCost = weights.cost ?? 0.25;

  const normLatency = normalize(metrics.map((m) => m.meanLatencyMs));
  const normCost = normalize(metrics.map((m) => m.totalCostUsd));

  const compositeScores: Record<string, number> = {};
  let best: { label: string; score: number } | null = null;
  metrics.forEach((m, i) => {
    const composite =
      wQuality * m.quality - wLatency * normLatency[i] - wCost * normCost[i];
    compositeScores[m.label] = composite;
    if (!best || composite > best.score) {
      best = { label: m.label, score: composite };
    }
  });

  const winner = best as { label: string; score: number } | null;
  const recommendation = winner ? winner.label : "";
  const rationale = winner
    ? `Variant "${winner.label}" maximizes composite score ` +
      `(quality=${wQuality}, latency=-${wLatency}, cost=-${wCost}) at ${winner.score.toFixed(4)}.`
    : "No variants evaluated.";

  return {
    suite: suite.name,
    variants: metrics,
    recommendation,
    compositeScores,
    rationale,
  };
}
