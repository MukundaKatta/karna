import { describe, it, expect } from "vitest";
import {
  selectModelTier,
  resolvePreferredTier,
  estimateTierCost,
  DEFAULT_TIER_TABLE,
  TIER_ORDER,
  type ModelTierTable,
  type CostRouteResult,
} from "../../agent/src/models/cost-router.js";
import type { TokenUsage } from "@karna/shared/utils/cost.js";

const USAGE: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

// With 1M in + 1M out tokens against DEFAULT_TIER_TABLE:
//   cheap  (haiku):  0.8 + 4   =  4.8
//   mid    (sonnet): 3   + 15  = 18
//   flagship (opus): 15  + 75  = 90

describe("resolvePreferredTier", () => {
  it("maps explicit tier signals through unchanged", () => {
    expect(resolvePreferredTier({ kind: "tier", tier: "mid" })).toBe("mid");
  });

  it("buckets scores deterministically", () => {
    expect(resolvePreferredTier({ kind: "score", score: 0 })).toBe("cheap");
    expect(resolvePreferredTier({ kind: "score", score: 0.32 })).toBe("cheap");
    expect(resolvePreferredTier({ kind: "score", score: 0.4 })).toBe("mid");
    expect(resolvePreferredTier({ kind: "score", score: 0.7 })).toBe("flagship");
    expect(resolvePreferredTier({ kind: "score", score: 1 })).toBe("flagship");
  });

  it("clamps out-of-range / NaN scores", () => {
    expect(resolvePreferredTier({ kind: "score", score: -5 })).toBe("cheap");
    expect(resolvePreferredTier({ kind: "score", score: 99 })).toBe("flagship");
    expect(resolvePreferredTier({ kind: "score", score: Number.NaN })).toBe("cheap");
  });
});

describe("estimateTierCost", () => {
  it("prices known models via shared cost utils", () => {
    expect(estimateTierCost("claude-haiku-4-20250514", USAGE)).toBeCloseTo(4.8, 6);
    expect(estimateTierCost("claude-opus-4-20250514", USAGE)).toBeCloseTo(90, 6);
  });

  it("returns Infinity for unknown models", () => {
    expect(estimateTierCost("totally-unknown-model-xyz", USAGE)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("selectModelTier", () => {
  it("uses the preferred tier when no budget is set", () => {
    const r = selectModelTier({ kind: "tier", tier: "flagship" }, { estimatedUsage: USAGE });
    expect(r.tier).toBe("flagship");
    expect(r.model).toBe(DEFAULT_TIER_TABLE.flagship);
    expect(r.adjustment).toBe("none");
    expect(r.overBudget).toBe(false);
    expect(r.estimatedCostUsd).toBeCloseTo(90, 6);
  });

  it("downgrades when preferred tier exceeds budget", () => {
    // Budget of $20 fits mid (18) but not flagship (90).
    const r = selectModelTier(
      { kind: "tier", tier: "flagship" },
      { estimatedUsage: USAGE, budgetUsd: 20 },
    );
    expect(r.preferredTier).toBe("flagship");
    expect(r.tier).toBe("mid");
    expect(r.adjustment).toBe("downgraded");
    expect(r.overBudget).toBe(false);
  });

  it("downgrades all the way to cheap when only cheap fits", () => {
    // Budget of $5 fits only cheap (4.8).
    const r = selectModelTier(
      { kind: "tier", tier: "flagship" },
      { estimatedUsage: USAGE, budgetUsd: 5 },
    );
    expect(r.tier).toBe("cheap");
    expect(r.adjustment).toBe("downgraded");
    expect(r.overBudget).toBe(false);
  });

  it("falls back to cheapest and flags overBudget when nothing fits", () => {
    const r = selectModelTier(
      { kind: "tier", tier: "flagship" },
      { estimatedUsage: USAGE, budgetUsd: 1 },
    );
    expect(r.tier).toBe("cheap");
    expect(r.adjustment).toBe("downgraded");
    expect(r.overBudget).toBe(true);
  });

  it("does not upgrade by default even with generous budget", () => {
    const r = selectModelTier(
      { kind: "tier", tier: "cheap" },
      { estimatedUsage: USAGE, budgetUsd: 1000 },
    );
    expect(r.tier).toBe("cheap");
    expect(r.adjustment).toBe("none");
  });

  it("upgrades to the most capable affordable tier when allowUpgrade and headroom permit", () => {
    // Budget $200: cheap (4.8) is far under threshold (200*0.5=100) → upgrade.
    // flagship (90) <= 200 so it should reach flagship.
    const r = selectModelTier(
      { kind: "tier", tier: "cheap" },
      { estimatedUsage: USAGE, budgetUsd: 200, allowUpgrade: true },
    );
    expect(r.tier).toBe("flagship");
    expect(r.adjustment).toBe("upgraded");
  });

  it("upgrade stops at the most capable tier still within budget", () => {
    // Budget $40: threshold 20, cheap(4.8) under it → eligible.
    // mid(18) <= 40 ok, flagship(90) > 40 stop → land on mid.
    const r = selectModelTier(
      { kind: "tier", tier: "cheap" },
      { estimatedUsage: USAGE, budgetUsd: 40, allowUpgrade: true },
    );
    expect(r.tier).toBe("mid");
    expect(r.adjustment).toBe("upgraded");
  });

  it("does not upgrade when preferred tier already consumes too much headroom", () => {
    // Budget $30: threshold 15. cheap(4.8) <= 15 → eligible, but make preferred mid.
    // mid(18) > threshold(15) → not eligible to upgrade.
    const r = selectModelTier(
      { kind: "tier", tier: "mid" },
      { estimatedUsage: USAGE, budgetUsd: 30, allowUpgrade: true },
    );
    expect(r.tier).toBe("mid");
    expect(r.adjustment).toBe("none");
  });

  it("respects a custom tier table", () => {
    const table: ModelTierTable = {
      cheap: "gpt-4o-mini",
      mid: "gpt-4o",
      flagship: "claude-opus-4-20250514",
    };
    const r = selectModelTier({ kind: "tier", tier: "cheap" }, { table, estimatedUsage: USAGE });
    expect(r.model).toBe("gpt-4o-mini");
    // gpt-4o-mini: 0.15 + 0.6 = 0.75
    expect(r.estimatedCostUsd).toBeCloseTo(0.75, 6);
  });

  it("applies a deterministic override hook (tier)", () => {
    const r = selectModelTier(
      { kind: "tier", tier: "mid" },
      {
        estimatedUsage: USAGE,
        override: (_ctx, proposed: CostRouteResult) =>
          proposed.tier === "mid" ? { tier: "cheap" } : undefined,
      },
    );
    expect(r.tier).toBe("cheap");
    expect(r.adjustment).toBe("override");
    expect(r.model).toBe(DEFAULT_TIER_TABLE.cheap);
  });

  it("applies a deterministic override hook (explicit model)", () => {
    const r = selectModelTier(
      { kind: "tier", tier: "mid" },
      {
        estimatedUsage: USAGE,
        budgetUsd: 5,
        override: () => ({ model: "gpt-4o" }),
      },
    );
    expect(r.model).toBe("gpt-4o");
    expect(r.adjustment).toBe("override");
    // gpt-4o: 2.5 + 10 = 12.5 > budget 5 → overBudget
    expect(r.overBudget).toBe(true);
  });

  it("TIER_ORDER is cheapest to most capable", () => {
    expect([...TIER_ORDER]).toEqual(["cheap", "mid", "flagship"]);
  });
});
