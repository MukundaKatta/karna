// ─── Cost-Aware Model Routing (#594) ───────────────────────────────────────
// Pure/deterministic selection of a model tier based on an injected
// task-complexity signal, a per-request budget, and a model-tier pricing table.
//
// Given an estimate of how many input/output tokens a task will consume, this
// module estimates the cost of each candidate tier (using the shared cost
// utilities), then selects the most capable tier whose estimated cost fits the
// budget. If the preferred tier (derived from complexity) is too expensive it
// downgrades; if budget is generous and `allowUpgrade` is set it may upgrade.
//
// This module is intentionally side-effect free: no provider construction, no
// network, no logging. It is fully testable with plain data.

import { calculateCost, getModelPricing } from "@karna/shared/utils/cost.js";
import type { TokenUsage } from "@karna/shared/utils/cost.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/** The three cost/capability tiers, cheapest → most capable. */
export type CostTier = "cheap" | "mid" | "flagship";

/** Ordered list of tiers from least to most capable. */
export const TIER_ORDER: readonly CostTier[] = ["cheap", "mid", "flagship"] as const;

/**
 * A task-complexity signal. This is *injected* — callers compute it however
 * they like (e.g. from `assessComplexity` in router.ts) and map it onto a
 * preferred starting tier. We accept either an explicit tier or a normalized
 * 0..1 score which we bucket deterministically.
 */
export type ComplexitySignal =
  | { kind: "tier"; tier: CostTier }
  | { kind: "score"; score: number };

/** Maps a single tier to a concrete model id used for pricing + selection. */
export interface TierModel {
  tier: CostTier;
  model: string;
}

/** The model-tier table: one model id per tier. */
export type ModelTierTable = Record<CostTier, string>;

/**
 * An override hook. Receives the proposed selection plus full context and may
 * return a replacement tier (or model) to force a particular choice. Returning
 * `undefined` keeps the default decision. Must be pure/deterministic for the
 * router to remain deterministic.
 */
export type CostRouteOverride = (
  ctx: CostRouteContext,
  proposed: CostRouteResult,
) => Partial<{ tier: CostTier; model: string }> | undefined;

export interface CostRouteOptions {
  /** Model id per tier. Defaults to {@link DEFAULT_TIER_TABLE}. */
  table?: ModelTierTable;
  /**
   * Estimated token usage for the task, used to price each tier. If omitted a
   * conservative default estimate is used.
   */
  estimatedUsage?: TokenUsage;
  /** Hard per-request budget in USD. When omitted, no budget constraint. */
  budgetUsd?: number;
  /**
   * If true, when the preferred tier fits well within budget the router may
   * upgrade to a more capable tier that still fits. Default: false.
   */
  allowUpgrade?: boolean;
  /**
   * Fraction (0..1) of the budget that a tier's estimated cost must stay
   * under to be eligible for an *upgrade*. Default 0.5 — i.e. only upgrade if
   * the cheaper tier used less than half the budget, leaving headroom.
   */
  upgradeHeadroom?: number;
  /** Optional deterministic override hook. */
  override?: CostRouteOverride;
}

export interface CostRouteContext {
  signal: ComplexitySignal;
  preferredTier: CostTier;
  table: ModelTierTable;
  estimatedUsage: TokenUsage;
  budgetUsd?: number;
}

export interface CostRouteResult {
  /** The selected tier. */
  tier: CostTier;
  /** The selected concrete model id. */
  model: string;
  /** Estimated cost in USD for the selected tier given the usage estimate. */
  estimatedCostUsd: number;
  /** The tier the complexity signal preferred before budget adjustment. */
  preferredTier: CostTier;
  /** Why the final tier differs (or not) from the preferred tier. */
  adjustment: "none" | "downgraded" | "upgraded" | "override";
  /**
   * True when no tier fit inside the budget and the cheapest tier was chosen
   * as a best-effort fallback.
   */
  overBudget: boolean;
}

// ─── Defaults ─────────────────────────────────────────────────────────────

/**
 * Default tier table. Model ids match the shared pricing table so cost
 * estimation works out of the box.
 */
export const DEFAULT_TIER_TABLE: ModelTierTable = {
  cheap: "claude-haiku-4-20250514",
  mid: "claude-sonnet-4-20250514",
  flagship: "claude-opus-4-20250514",
};

/**
 * Conservative default usage estimate when the caller does not provide one.
 * Roughly a small prompt with a medium-length completion.
 */
const DEFAULT_USAGE: TokenUsage = {
  inputTokens: 2_000,
  outputTokens: 1_000,
};

const DEFAULT_UPGRADE_HEADROOM = 0.5;

// ─── Signal → preferred tier ────────────────────────────────────────────────

/**
 * Resolve a complexity signal to a preferred starting tier. Score buckets are
 * deterministic: [0, 1/3) → cheap, [1/3, 2/3) → mid, [2/3, 1] → flagship.
 */
export function resolvePreferredTier(signal: ComplexitySignal): CostTier {
  if (signal.kind === "tier") return signal.tier;
  const s = clamp01(signal.score);
  if (s < 1 / 3) return "cheap";
  if (s < 2 / 3) return "mid";
  return "flagship";
}

// ─── Cost estimation ────────────────────────────────────────────────────────

/**
 * Estimate the cost of a given model for the supplied usage. Falls back to
 * `Infinity` when the model has no known pricing (so it is never selected by
 * the budget filter, but can still be returned as a last resort).
 */
export function estimateTierCost(model: string, usage: TokenUsage): number {
  if (!getModelPricing(model)) return Number.POSITIVE_INFINITY;
  return calculateCost(model, usage).totalCost;
}

// ─── Core selection ─────────────────────────────────────────────────────────

/**
 * Select a model tier given a complexity signal, budget, and tier table.
 * Deterministic and pure.
 */
export function selectModelTier(
  signal: ComplexitySignal,
  options: CostRouteOptions = {},
): CostRouteResult {
  const table = options.table ?? DEFAULT_TIER_TABLE;
  const estimatedUsage = options.estimatedUsage ?? DEFAULT_USAGE;
  const budgetUsd = options.budgetUsd;
  const allowUpgrade = options.allowUpgrade ?? false;
  const headroom = clamp01(options.upgradeHeadroom ?? DEFAULT_UPGRADE_HEADROOM);

  const preferredTier = resolvePreferredTier(signal);
  const ctx: CostRouteContext = {
    signal,
    preferredTier,
    table,
    estimatedUsage,
    budgetUsd,
  };

  const costOf = (tier: CostTier): number =>
    estimateTierCost(table[tier], estimatedUsage);

  let tier = preferredTier;
  let adjustment: CostRouteResult["adjustment"] = "none";
  let overBudget = false;

  if (budgetUsd !== undefined) {
    const preferredIndex = TIER_ORDER.indexOf(preferredTier);

    if (costOf(preferredTier) > budgetUsd) {
      // ── Downgrade: walk down toward cheaper tiers until one fits. ──
      let chosen: CostTier | undefined;
      for (let i = preferredIndex - 1; i >= 0; i--) {
        const t = TIER_ORDER[i]!;
        if (costOf(t) <= budgetUsd) {
          chosen = t;
          break;
        }
      }
      if (chosen) {
        tier = chosen;
        adjustment = "downgraded";
      } else {
        // Nothing fits — best-effort: cheapest tier overall.
        tier = TIER_ORDER[0]!;
        adjustment = "downgraded";
        overBudget = costOf(tier) > budgetUsd;
      }
    } else if (allowUpgrade) {
      // ── Upgrade: if the preferred tier leaves ample headroom, move up to ──
      // the most capable tier that still fits within budget.
      const threshold = budgetUsd * headroom;
      if (costOf(preferredTier) <= threshold) {
        let chosen = preferredTier;
        for (let i = preferredIndex + 1; i < TIER_ORDER.length; i++) {
          const t = TIER_ORDER[i]!;
          if (costOf(t) <= budgetUsd) {
            chosen = t;
          } else {
            break;
          }
        }
        if (chosen !== preferredTier) {
          tier = chosen;
          adjustment = "upgraded";
        }
      }
    }
  }

  let model = table[tier];
  let estimatedCostUsd = costOf(tier);

  // ── Override hook (applied last; deterministic). ──
  if (options.override) {
    const proposed: CostRouteResult = {
      tier,
      model,
      estimatedCostUsd,
      preferredTier,
      adjustment,
      overBudget,
    };
    const ov = options.override(ctx, proposed);
    if (ov && (ov.tier !== undefined || ov.model !== undefined)) {
      if (ov.tier !== undefined) {
        tier = ov.tier;
        model = table[tier];
      }
      if (ov.model !== undefined) {
        model = ov.model;
      }
      estimatedCostUsd = estimateTierCost(model, estimatedUsage);
      adjustment = "override";
      overBudget = budgetUsd !== undefined && estimatedCostUsd > budgetUsd;
    }
  }

  return {
    tier,
    model,
    estimatedCostUsd,
    preferredTier,
    adjustment,
    overBudget,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
