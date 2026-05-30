import { calculateTotalCost } from "./cost.js";
import type { TokenUsage } from "./cost.js";

/**
 * Stop reason emitted when a budget limit is hit (or null if within budget).
 */
export type BudgetStopReason =
  | "max-input-tokens"
  | "max-output-tokens"
  | "max-total-tokens"
  | "max-cost"
  | null;

export interface TokenBudgetLimits {
  /** Maximum cumulative input tokens. Omit/0 for no limit. */
  maxInputTokens?: number;
  /** Maximum cumulative output tokens. Omit/0 for no limit. */
  maxOutputTokens?: number;
  /** Maximum cumulative total tokens. Omit/0 for no limit. */
  maxTotalTokens?: number;
  /** Maximum cumulative cost in USD. Omit/0 for no limit. */
  maxCostUsd?: number;
}

export interface TokenBudgetSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

/**
 * Tracks consumed input/output tokens and accumulated cost against configured
 * limits. Designed for use during a streaming agent loop where usage arrives
 * incrementally. Cost is derived via `calculateCost` from utils/cost.
 */
export class TokenBudget {
  private inputTokens = 0;
  private outputTokens = 0;
  private costUsd = 0;

  constructor(private readonly limits: TokenBudgetLimits = {}) {}

  /**
   * Record a usage increment for a given model and return the running snapshot.
   * `usage.totalTokens` is trusted if provided; otherwise it is derived from
   * input + output.
   */
  consume(usage: TokenUsage, model: string): TokenBudgetSnapshot {
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.costUsd += calculateTotalCost(model, usage);
    return this.snapshot();
  }

  /** Current consumption snapshot. */
  snapshot(): TokenBudgetSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.inputTokens + this.outputTokens,
      costUsd: this.costUsd,
    };
  }

  /**
   * Remaining headroom per dimension. Values are clamped at 0. Dimensions with
   * no configured limit report Infinity.
   */
  remaining(): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  } {
    return {
      inputTokens: headroom(this.limits.maxInputTokens, this.inputTokens),
      outputTokens: headroom(this.limits.maxOutputTokens, this.outputTokens),
      totalTokens: headroom(this.limits.maxTotalTokens, this.inputTokens + this.outputTokens),
      costUsd: headroom(this.limits.maxCostUsd, this.costUsd),
    };
  }

  /** Whether any configured limit has been reached or exceeded. */
  isExceeded(): boolean {
    return this.reason() !== null;
  }

  /**
   * The first budget dimension that has been reached/exceeded, or null if the
   * budget is still within limits. Checked in a stable priority order.
   */
  reason(): BudgetStopReason {
    const total = this.inputTokens + this.outputTokens;
    if (exceeds(this.limits.maxInputTokens, this.inputTokens)) return "max-input-tokens";
    if (exceeds(this.limits.maxOutputTokens, this.outputTokens)) return "max-output-tokens";
    if (exceeds(this.limits.maxTotalTokens, total)) return "max-total-tokens";
    if (exceeds(this.limits.maxCostUsd, this.costUsd)) return "max-cost";
    return null;
  }
}

function hasLimit(limit?: number): limit is number {
  return typeof limit === "number" && limit > 0;
}

function exceeds(limit: number | undefined, value: number): boolean {
  return hasLimit(limit) && value >= limit;
}

function headroom(limit: number | undefined, value: number): number {
  if (!hasLimit(limit)) return Infinity;
  return Math.max(0, limit - value);
}
