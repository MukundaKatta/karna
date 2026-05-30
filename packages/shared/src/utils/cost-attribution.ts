import { calculateTotalCost } from "./cost.js";
import type { TokenUsage } from "./cost.js";

/**
 * A single attributed cost event. The cost is computed at record time via
 * `calculateCost` so aggregation stays cheap.
 */
export interface CostEvent {
  userId?: string;
  sessionId: string;
  toolName?: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  /** Unix epoch milliseconds the event was recorded. */
  timestamp: number;
}

export interface RecordCostInput {
  userId?: string;
  sessionId: string;
  toolName?: string;
  model: string;
  usage: TokenUsage;
  /** Override the timestamp (defaults to Date.now()). */
  timestamp?: number;
}

/** Dimensions cost can be aggregated by. */
export type CostDimension = "userId" | "sessionId" | "toolName" | "model";

export interface CostAggregate {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  events: number;
}

const UNATTRIBUTED = "(unattributed)";

/**
 * Records cost events tagged by user/session/tool/model and aggregates totals
 * along any single dimension. Builds on `calculateCost` from utils/cost.
 */
export class CostAttributor {
  private readonly events: CostEvent[] = [];

  /** Record a cost event, computing its USD cost from usage + model. */
  record(input: RecordCostInput): CostEvent {
    const event: CostEvent = {
      userId: input.userId,
      sessionId: input.sessionId,
      toolName: input.toolName,
      model: input.model,
      usage: input.usage,
      costUsd: calculateTotalCost(input.model, input.usage),
      timestamp: input.timestamp ?? Date.now(),
    };
    this.events.push(event);
    return event;
  }

  /** All recorded events (defensive copy). */
  all(): CostEvent[] {
    return [...this.events];
  }

  /** Grand total across every recorded event. */
  total(): CostAggregate {
    return this.events.reduce<CostAggregate>(
      (acc, e) => accumulate(acc, e),
      emptyAggregate(),
    );
  }

  /**
   * Aggregate totals grouped by a dimension. Events missing the chosen
   * dimension (e.g. no userId/toolName) are bucketed under "(unattributed)".
   */
  aggregateBy(dimension: CostDimension): Record<string, CostAggregate> {
    const out: Record<string, CostAggregate> = {};
    for (const e of this.events) {
      const key = (e[dimension] as string | undefined) ?? UNATTRIBUTED;
      out[key] = accumulate(out[key] ?? emptyAggregate(), e);
    }
    return out;
  }

  /** Total cost for a specific dimension value (0 if none). */
  totalFor(dimension: CostDimension, value: string): CostAggregate {
    return this.events
      .filter((e) => ((e[dimension] as string | undefined) ?? UNATTRIBUTED) === value)
      .reduce<CostAggregate>((acc, e) => accumulate(acc, e), emptyAggregate());
  }

  /** Remove all recorded events. */
  reset(): void {
    this.events.length = 0;
  }
}

function emptyAggregate(): CostAggregate {
  return { costUsd: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, events: 0 };
}

function accumulate(acc: CostAggregate, e: CostEvent): CostAggregate {
  return {
    costUsd: acc.costUsd + e.costUsd,
    inputTokens: acc.inputTokens + e.usage.inputTokens,
    outputTokens: acc.outputTokens + e.usage.outputTokens,
    totalTokens: acc.totalTokens + e.usage.inputTokens + e.usage.outputTokens,
    events: acc.events + 1,
  };
}

export const COST_UNATTRIBUTED = UNATTRIBUTED;
