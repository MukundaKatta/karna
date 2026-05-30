import { z } from 'zod';
import type { Logger } from 'pino';

/**
 * Issue #531 — Sub-agent result aggregation (map-reduce).
 *
 * A reducer interface plus built-in reducers (concat, majority-vote,
 * llm-summarize) for combining the results of parallel/sequential sub-agents
 * into a single aggregated result. Pure and testable. The `llm-summarize`
 * reducer takes an injected summarizer function so this module has no LLM or
 * network dependency.
 */

/**
 * The result of a single sub-agent's work, as consumed by reducers. This is a
 * minimal, self-contained shape; callers can map richer types (e.g. the shared
 * `TaskAssignment`) onto it.
 */
export interface SubAgentResult {
  /** Identifier of the task/sub-agent that produced this result. */
  taskId: string;
  /** The textual output. */
  output: string;
  /** Whether the sub-agent succeeded. Failed results are ignored by reducers. */
  success: boolean;
  /** Optional error message for failed results. */
  error?: string;
}

export const AggregationStrategySchema = z.enum(['concat', 'majority-vote', 'llm-summarize', 'first-success']);
export type AggregationStrategy = z.infer<typeof AggregationStrategySchema>;

export interface AggregatedResult {
  output: string;
  /** Task ids of the sub-agent results that contributed to the output. */
  contributingTaskIds: string[];
  /** Number of successful inputs considered. */
  successCount: number;
  /** Number of failed inputs ignored. */
  failureCount: number;
  strategy: AggregationStrategy;
  metadata?: Record<string, unknown>;
}

/** A reducer combines many sub-agent results into one aggregated result. */
export interface Reducer {
  readonly strategy: AggregationStrategy;
  reduce(results: SubAgentResult[]): Promise<AggregatedResult> | AggregatedResult;
}

/** Injected summarizer signature used by {@link LlmSummarizeReducer}. */
export type SummarizerFn = (inputs: string[]) => Promise<string> | string;

function partition(results: SubAgentResult[]): {
  ok: SubAgentResult[];
  failed: SubAgentResult[];
} {
  return {
    ok: results.filter((r) => r.success),
    failed: results.filter((r) => !r.success),
  };
}

/** Concatenate successful outputs, joined by a configurable separator. */
export class ConcatReducer implements Reducer {
  readonly strategy = 'concat' as const;
  constructor(private readonly separator = '\n\n') {}

  reduce(results: SubAgentResult[]): AggregatedResult {
    const { ok, failed } = partition(results);
    return {
      output: ok.map((r) => r.output).join(this.separator),
      contributingTaskIds: ok.map((r) => r.taskId),
      successCount: ok.length,
      failureCount: failed.length,
      strategy: this.strategy,
    };
  }
}

/**
 * Majority vote over normalized outputs. The output with the most identical
 * (trimmed, case-insensitive by default) occurrences wins; ties are broken by
 * first occurrence order.
 */
export class MajorityVoteReducer implements Reducer {
  readonly strategy = 'majority-vote' as const;
  constructor(private readonly caseSensitive = false) {}

  private normalize(s: string): string {
    const trimmed = s.trim();
    return this.caseSensitive ? trimmed : trimmed.toLowerCase();
  }

  reduce(results: SubAgentResult[]): AggregatedResult {
    const { ok, failed } = partition(results);
    const counts = new Map<string, { count: number; firstIndex: number; original: string; ids: string[] }>();
    ok.forEach((r, i) => {
      const key = this.normalize(r.output);
      const entry = counts.get(key);
      if (entry) {
        entry.count += 1;
        entry.ids.push(r.taskId);
      } else {
        counts.set(key, { count: 1, firstIndex: i, original: r.output, ids: [r.taskId] });
      }
    });

    let winner: { count: number; firstIndex: number; original: string; ids: string[] } | null = null;
    for (const entry of counts.values()) {
      if (
        !winner ||
        entry.count > winner.count ||
        (entry.count === winner.count && entry.firstIndex < winner.firstIndex)
      ) {
        winner = entry;
      }
    }

    return {
      output: winner?.original ?? '',
      contributingTaskIds: winner?.ids ?? [],
      successCount: ok.length,
      failureCount: failed.length,
      strategy: this.strategy,
      metadata: { votes: winner?.count ?? 0, distinctOutputs: counts.size },
    };
  }
}

/** Pick the first successful result (by input order). */
export class FirstSuccessReducer implements Reducer {
  readonly strategy = 'first-success' as const;

  reduce(results: SubAgentResult[]): AggregatedResult {
    const { ok, failed } = partition(results);
    const first = ok[0];
    return {
      output: first?.output ?? '',
      contributingTaskIds: first ? [first.taskId] : [],
      successCount: ok.length,
      failureCount: failed.length,
      strategy: this.strategy,
    };
  }
}

/**
 * Summarize successful outputs via an injected summarizer function (e.g. an
 * LLM call supplied by the runtime). Has no model dependency itself.
 */
export class LlmSummarizeReducer implements Reducer {
  readonly strategy = 'llm-summarize' as const;
  constructor(
    private readonly summarizer: SummarizerFn,
    private readonly logger?: Logger,
  ) {}

  async reduce(results: SubAgentResult[]): Promise<AggregatedResult> {
    const { ok, failed } = partition(results);
    const inputs = ok.map((r) => r.output);
    let output = '';
    if (inputs.length > 0) {
      this.logger?.debug({ count: inputs.length }, 'llm-summarize reduce');
      output = await this.summarizer(inputs);
    }
    return {
      output,
      contributingTaskIds: ok.map((r) => r.taskId),
      successCount: ok.length,
      failureCount: failed.length,
      strategy: this.strategy,
    };
  }
}

export interface AggregatorOptions {
  strategy?: AggregationStrategy;
  /** Required when strategy is 'llm-summarize'. */
  summarizer?: SummarizerFn;
  separator?: string;
  caseSensitive?: boolean;
  logger?: Logger;
}

/** Build a reducer for the given strategy. */
export function createReducer(opts: AggregatorOptions = {}): Reducer {
  const strategy = opts.strategy ?? 'concat';
  switch (strategy) {
    case 'concat':
      return new ConcatReducer(opts.separator);
    case 'majority-vote':
      return new MajorityVoteReducer(opts.caseSensitive);
    case 'first-success':
      return new FirstSuccessReducer();
    case 'llm-summarize':
      if (!opts.summarizer) {
        throw new Error("aggregation strategy 'llm-summarize' requires a summarizer function");
      }
      return new LlmSummarizeReducer(opts.summarizer, opts.logger);
    default: {
      const _exhaustive: never = strategy;
      throw new Error(`unknown aggregation strategy: ${String(_exhaustive)}`);
    }
  }
}

/** Convenience: aggregate results in one call. */
export async function aggregate(
  results: SubAgentResult[],
  opts: AggregatorOptions = {},
): Promise<AggregatedResult> {
  return createReducer(opts).reduce(results);
}
