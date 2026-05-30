// ─── Workflow DAG Executor ───────────────────────────────────────────────────
//
// A pure, dependency-aware executor for directed acyclic graphs of injected
// step functions. Complements `engine.ts` (the node/edge graph runtime) by
// providing a lower-level, fully testable primitive: declare steps with
// explicit dependencies, per-step retries with backoff, and conditional edges
// that gate whether downstream steps run.
//
// This module is additive and does not import or modify the WorkflowEngine.
// It reuses the `RunStatus` shape from engine.ts where it makes sense.
//
// ─────────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type { RunStatus } from "./engine.js";

const logger = pino({ name: "workflow-dag" });

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Context passed to every step function during a DAG run.
 */
export interface DagStepContext {
  /** Unique id of the step being executed. */
  stepId: string;
  /**
   * Outputs of all already-completed dependency steps, keyed by step id.
   * Only dependencies (transitive results are not flattened) are guaranteed
   * present; use this to read upstream results.
   */
  results: Readonly<Record<string, unknown>>;
  /** 0-based retry attempt index (0 = first try). */
  attempt: number;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal;
}

/**
 * The injected unit of work for a step.
 */
export type DagStepFn = (context: DagStepContext) => Promise<unknown> | unknown;

/**
 * Retry policy for an individual step. All fields optional; defaults mean
 * "no retries".
 */
export interface DagRetryPolicy {
  /** Maximum number of *additional* attempts after the first (default 0). */
  maxRetries?: number;
  /** Base backoff in ms before the first retry (default 0). */
  backoffMs?: number;
  /** Multiplier applied to the backoff each subsequent retry (default 1). */
  backoffFactor?: number;
  /** Optional ceiling on a single backoff delay in ms. */
  maxBackoffMs?: number;
}

/**
 * A conditional edge predicate. Given the results gathered so far, return
 * `false` to *skip* this step (and, transitively, anything depending on it).
 */
export type DagCondition = (results: Readonly<Record<string, unknown>>) => boolean;

/**
 * Declarative description of a single DAG step.
 */
export interface DagStep {
  /** Unique id within the DAG. */
  id: string;
  /** Ids of steps that must complete before this one runs. */
  dependsOn?: string[];
  /** The work to perform. */
  run: DagStepFn;
  /** Optional retry/backoff policy. */
  retry?: DagRetryPolicy;
  /**
   * Optional gate. Evaluated after dependencies complete; if it returns
   * `false`, the step is skipped (status "skipped") and never invoked.
   */
  when?: DagCondition;
}

/**
 * Outcome status for a single step.
 */
export type DagStepStatus = "completed" | "failed" | "skipped";

/**
 * Result of executing one step.
 */
export interface DagStepResult {
  stepId: string;
  status: DagStepStatus;
  /** Number of attempts actually made (0 for skipped steps). */
  attempts: number;
  output: unknown;
  error?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

/**
 * Aggregate result of a DAG run.
 */
export interface DagRunResult {
  status: RunStatus;
  /** Step results keyed by step id, in completion order. */
  steps: DagStepResult[];
  /** Convenience map of stepId -> output for completed steps. */
  outputs: Record<string, unknown>;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  error?: string;
}

/**
 * Options controlling a DAG run.
 */
export interface DagRunOptions {
  /** Abort signal forwarded to step contexts and checked between steps. */
  signal?: AbortSignal;
  /**
   * Injectable sleep function (defaults to setTimeout-based). Lets tests run
   * retries/backoff without real timers.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * When true (default), a failed step aborts the whole run. When false, the
   * run continues; dependents of a failed/skipped step are skipped.
   */
  failFast?: boolean;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/**
 * Thrown by `validateDag` / `runDag` when the graph is not a DAG.
 */
export class DagCycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Workflow DAG contains a cycle: ${cycle.join(" -> ")}`);
    this.name = "DagCycleError";
  }
}

/**
 * Thrown when a step depends on an id that does not exist, or when ids are
 * duplicated.
 */
export class DagDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DagDefinitionError";
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

interface ValidatedDag {
  byId: Map<string, DagStep>;
  /** Topologically sorted step ids. */
  order: string[];
}

/**
 * Validate a set of steps: unique ids, existing dependencies, and acyclicity.
 * Returns a topological ordering. Throws `DagDefinitionError` or
 * `DagCycleError`.
 */
export function validateDag(steps: DagStep[]): ValidatedDag {
  const byId = new Map<string, DagStep>();
  for (const step of steps) {
    if (byId.has(step.id)) {
      throw new DagDefinitionError(`Duplicate step id "${step.id}"`);
    }
    byId.set(step.id, step);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!byId.has(dep)) {
        throw new DagDefinitionError(
          `Step "${step.id}" depends on unknown step "${dep}"`
        );
      }
      if (dep === step.id) {
        throw new DagCycleError([step.id, step.id]);
      }
    }
  }

  const order = topoSort(byId);
  return { byId, order };
}

/**
 * Kahn-style topological sort with explicit cycle detection (DFS path tracking
 * to report the offending cycle for diagnostics).
 */
function topoSort(byId: Map<string, DagStep>): string[] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of byId.keys()) color.set(id, WHITE);

  const order: string[] = [];
  const stack: string[] = [];

  const visit = (id: string): void => {
    color.set(id, GRAY);
    stack.push(id);
    const step = byId.get(id);
    for (const dep of step?.dependsOn ?? []) {
      const c = color.get(dep);
      if (c === GRAY) {
        // Found a back-edge: reconstruct the cycle from the current stack.
        const start = stack.indexOf(dep);
        const cycle = stack.slice(start).concat(dep);
        throw new DagCycleError(cycle);
      }
      if (c === WHITE) visit(dep);
    }
    stack.pop();
    color.set(id, BLACK);
    order.push(id);
  };

  for (const id of byId.keys()) {
    if (color.get(id) === WHITE) visit(id);
  }
  // `order` lists dependencies before dependents (deps pushed first).
  return order;
}

// ─── Execution ────────────────────────────────────────────────────────────────

const defaultSleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/**
 * Execute a DAG of injected step functions, respecting dependencies, retries
 * with backoff, and conditional edges. Pure with respect to its inputs: all
 * effects live inside the injected step functions.
 *
 * Behavior:
 * - Steps run in topological order; a step runs only after all its
 *   dependencies have *completed*.
 * - A step is skipped if its `when` predicate returns false, or if any
 *   dependency was skipped or failed.
 * - On step failure, retries are attempted per the step's retry policy. If all
 *   attempts fail and `failFast` (default true) is set, the run aborts;
 *   otherwise the run continues and dependents are skipped.
 */
export async function runDag(
  steps: DagStep[],
  options: DagRunOptions = {}
): Promise<DagRunResult> {
  const startedAt = Date.now();
  const sleep = options.sleep ?? defaultSleep;
  const failFast = options.failFast ?? true;

  const { byId, order } = validateDag(steps);

  const results: DagStepResult[] = [];
  const outputs: Record<string, unknown> = {};
  const statusById = new Map<string, DagStepStatus>();

  let runStatus: RunStatus = "completed";
  let runError: string | undefined;

  for (const stepId of order) {
    if (options.signal?.aborted) {
      runStatus = "cancelled";
      runError = "Run aborted";
      break;
    }

    const step = byId.get(stepId)!;
    const deps = step.dependsOn ?? [];

    // Skip if any dependency was not completed (skipped or failed).
    const blockedBy = deps.find((d) => statusById.get(d) !== "completed");
    if (blockedBy !== undefined) {
      const now = Date.now();
      const skipped: DagStepResult = {
        stepId,
        status: "skipped",
        attempts: 0,
        output: undefined,
        startedAt: now,
        endedAt: now,
        durationMs: 0,
      };
      statusById.set(stepId, "skipped");
      results.push(skipped);
      logger.debug({ stepId, blockedBy }, "Skipping step: dependency not completed");
      continue;
    }

    // Conditional edge gate.
    if (step.when && !step.when(outputs)) {
      const now = Date.now();
      results.push({
        stepId,
        status: "skipped",
        attempts: 0,
        output: undefined,
        startedAt: now,
        endedAt: now,
        durationMs: 0,
      });
      statusById.set(stepId, "skipped");
      logger.debug({ stepId }, "Skipping step: condition returned false");
      continue;
    }

    const result = await runStep(step, outputs, options.signal, sleep);
    results.push(result);
    statusById.set(stepId, result.status);

    if (result.status === "completed") {
      outputs[stepId] = result.output;
    } else if (result.status === "failed") {
      if (failFast) {
        runStatus = "failed";
        runError = result.error;
        break;
      }
      // Non-fail-fast: mark the run as failed overall but continue; dependents
      // will be skipped by the blockedBy check above.
      runStatus = "failed";
      runError ??= result.error;
    }
  }

  const endedAt = Date.now();
  return {
    status: runStatus,
    steps: results,
    outputs,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    error: runError,
  };
}

/**
 * Run a single step with its retry/backoff policy. Always resolves with a
 * DagStepResult (never throws for step-level failures).
 */
async function runStep(
  step: DagStep,
  outputs: Record<string, unknown>,
  signal: AbortSignal | undefined,
  sleep: (ms: number) => Promise<void>
): Promise<DagStepResult> {
  const startedAt = Date.now();
  const policy = step.retry ?? {};
  const maxRetries = Math.max(0, policy.maxRetries ?? 0);
  const baseBackoff = Math.max(0, policy.backoffMs ?? 0);
  const factor = policy.backoffFactor ?? 1;

  let lastError: string | undefined;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      const endedAt = Date.now();
      return {
        stepId: step.id,
        status: "failed",
        attempts,
        output: undefined,
        error: "Aborted",
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
      };
    }

    attempts = attempt + 1;
    try {
      const output = await step.run({
        stepId: step.id,
        results: outputs,
        attempt,
        signal,
      });
      const endedAt = Date.now();
      return {
        stepId: step.id,
        status: "completed",
        attempts,
        output,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.debug(
        { stepId: step.id, attempt, error: lastError },
        "Step attempt failed"
      );
      // Schedule a backoff before the next attempt, if any remain.
      if (attempt < maxRetries && !signal?.aborted) {
        let delay = baseBackoff * Math.pow(factor, attempt);
        if (policy.maxBackoffMs !== undefined) {
          delay = Math.min(delay, policy.maxBackoffMs);
        }
        await sleep(delay);
      }
    }
  }

  const endedAt = Date.now();
  return {
    stepId: step.id,
    status: "failed",
    attempts,
    output: undefined,
    error: lastError,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
  };
}
