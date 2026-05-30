import type { Logger } from 'pino';
import {
  aggregate,
  type AggregatedResult,
  type AggregatorOptions,
  type SubAgentResult,
} from './aggregation.js';

/**
 * Issue #527 — Multi-sandbox parallel sub-agent execution.
 *
 * A pure scheduler that runs N sub-agent tasks (an injected async function)
 * with a bounded concurrency limit, cooperative cancellation via AbortSignal,
 * and per-task result/error capture. No real sandboxing happens here — only the
 * scheduling and aggregation logic. The captured results map directly onto
 * {@link SubAgentResult}, so they can be combined with the reducers from
 * aggregation.ts.
 */

/** A unit of work handed to the scheduler. */
export interface SubAgentTask<I = unknown> {
  /** Unique task id (used as the result's taskId). */
  id: string;
  /** Arbitrary input passed to the runner. */
  input: I;
}

/** The runner executes one task. It receives the per-run AbortSignal. */
export type SubAgentRunner<I = unknown> = (
  task: SubAgentTask<I>,
  signal: AbortSignal,
) => Promise<string>;

/** Per-task outcome captured by the scheduler. */
export interface SubAgentTaskResult {
  taskId: string;
  success: boolean;
  /** Output on success. */
  output?: string;
  /** Error message on failure. */
  error?: string;
  /** True when the task was aborted/cancelled before completing. */
  cancelled: boolean;
  /** Wall-clock duration in ms (measured via the injected clock). */
  durationMs: number;
}

export interface ParallelRunOptions {
  /** Max tasks running at once. Default: 4. Values < 1 are clamped to 1. */
  concurrency?: number;
  /** External signal; aborting it cancels pending and in-flight tasks. */
  signal?: AbortSignal;
  /**
   * If true, the first task failure aborts the rest (fail-fast). Default false:
   * all tasks run and failures are captured individually.
   */
  failFast?: boolean;
  /** Injected clock for deterministic durations. Defaults to Date.now. */
  now?: () => number;
  logger?: Logger;
}

export interface ParallelRunResult {
  results: SubAgentTaskResult[];
  /** True if every task succeeded. */
  allSucceeded: boolean;
  successCount: number;
  failureCount: number;
  cancelledCount: number;
}

/** Error thrown when the run is aborted before/while scheduling. */
export class SubAgentAbortError extends Error {
  constructor(message = 'sub-agent run aborted') {
    super(message);
    this.name = 'SubAgentAbortError';
  }
}

function clampConcurrency(value: number | undefined): number {
  const n = value ?? 4;
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * Run sub-agent tasks with bounded concurrency. Never rejects on individual
 * task failure — failures are captured per task. Honors cancellation: once the
 * provided signal aborts, not-yet-started tasks are marked cancelled and the
 * runner is asked to stop via the same signal.
 */
export async function runParallelSubAgents<I = unknown>(
  tasks: SubAgentTask<I>[],
  runner: SubAgentRunner<I>,
  options: ParallelRunOptions = {},
): Promise<ParallelRunResult> {
  const concurrency = clampConcurrency(options.concurrency);
  const now = options.now ?? Date.now;
  const logger = options.logger;

  // Internal controller chained to the external signal so failFast can cancel.
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const results: SubAgentTaskResult[] = new Array(tasks.length);
  let cursor = 0;

  const runOne = async (index: number): Promise<void> => {
    const task = tasks[index];
    const startedAt = now();
    if (controller.signal.aborted) {
      results[index] = {
        taskId: task.id,
        success: false,
        cancelled: true,
        error: 'cancelled before start',
        durationMs: 0,
      };
      return;
    }
    try {
      const output = await runner(task, controller.signal);
      results[index] = {
        taskId: task.id,
        success: true,
        output,
        cancelled: false,
        durationMs: now() - startedAt,
      };
    } catch (err) {
      const cancelled = controller.signal.aborted;
      const message = err instanceof Error ? err.message : String(err);
      results[index] = {
        taskId: task.id,
        success: false,
        cancelled,
        error: message,
        durationMs: now() - startedAt,
      };
      logger?.debug({ taskId: task.id, cancelled, error: message }, 'sub-agent task failed');
      if (options.failFast && !cancelled) {
        controller.abort();
      }
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= tasks.length) return;
      await runOne(index);
    }
  };

  const workerCount = Math.min(concurrency, tasks.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);

  let successCount = 0;
  let failureCount = 0;
  let cancelledCount = 0;
  for (const r of results) {
    if (r.success) successCount++;
    else failureCount++;
    if (r.cancelled) cancelledCount++;
  }

  return {
    results,
    allSucceeded: failureCount === 0,
    successCount,
    failureCount,
    cancelledCount,
  };
}

/** Map a {@link SubAgentTaskResult} onto the aggregation-friendly shape. */
export function toSubAgentResult(r: SubAgentTaskResult): SubAgentResult {
  return {
    taskId: r.taskId,
    output: r.output ?? '',
    success: r.success,
    ...(r.error ? { error: r.error } : {}),
  };
}

/**
 * Convenience: run tasks in parallel and reduce their outputs with a reducer
 * from aggregation.ts in one call.
 */
export async function runAndAggregate<I = unknown>(
  tasks: SubAgentTask<I>[],
  runner: SubAgentRunner<I>,
  options: ParallelRunOptions = {},
  aggregatorOptions: AggregatorOptions = {},
): Promise<{ run: ParallelRunResult; aggregated: AggregatedResult }> {
  const run = await runParallelSubAgents(tasks, runner, options);
  const aggregated = await aggregate(run.results.map(toSubAgentResult), aggregatorOptions);
  return { run, aggregated };
}
