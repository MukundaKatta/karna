// ─── Graceful Drain with In-Flight Checkpointing ──────────────────────────
//
// Issue #619 "Graceful shutdown with in-flight checkpointing".
//
// Pure orchestration that COMPLEMENTS `graceful.ts` without changing it. On a
// drain signal the coordinator:
//   1. flips a gate so no new work is admitted (`isAccepting()` -> false),
//   2. invokes an injected `checkpoint` hook for every in-flight run so that
//      partial state can be persisted/handed off,
//   3. waits for in-flight runs to settle within a grace period, enforcing a
//      hard deadline (`graceMs` + `hardDeadlineExtraMs`),
//   4. resolves with a structured `DrainResult`.
//
// All side effects (clock, checkpointing, run completion) are injected, so the
// module is fully deterministic and testable with fake timers.
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";

const logger = pino({ name: "drain" });

// ─── Types ────────────────────────────────────────────────────────────────

/** Minimal view of an in-flight unit of work the coordinator can checkpoint. */
export interface InFlightRun {
  /** Stable identifier (run / request / trace id). */
  readonly id: string;
  /**
   * Resolves when the run finishes naturally. The coordinator never rejects on
   * this — it only awaits settlement (success or failure) so a rejecting run
   * does not abort the drain.
   */
  readonly done: Promise<unknown>;
}

/** Outcome of checkpointing a single run. */
export interface CheckpointOutcome {
  readonly id: string;
  readonly ok: boolean;
  readonly error?: string;
}

/** Per-run drain disposition once the grace period elapses. */
export type RunDisposition = "completed" | "abandoned";

export interface RunResult {
  readonly id: string;
  readonly disposition: RunDisposition;
  readonly checkpointed: boolean;
}

export interface DrainResult {
  /** True when every in-flight run completed within the grace period. */
  readonly drained: boolean;
  /** True when the hard deadline fired before all runs completed. */
  readonly timedOut: boolean;
  readonly totalRuns: number;
  readonly completed: number;
  readonly abandoned: number;
  readonly checkpoints: CheckpointOutcome[];
  readonly runs: RunResult[];
  readonly durationMs: number;
}

export interface DrainHooks {
  /**
   * Snapshot of the runs currently in flight at the moment draining starts.
   * Called exactly once, after the accept-gate is closed.
   */
  readonly inFlight: () => Iterable<InFlightRun>;
  /**
   * Persist/hand-off partial state for a single run. May be async. Errors are
   * captured into the result rather than aborting the drain.
   */
  readonly checkpoint: (run: InFlightRun) => void | Promise<void>;
  /** Optional callback fired once draining starts (after the gate closes). */
  readonly onDrainStart?: (signal: string) => void;
  /** Injected clock (defaults to `Date.now`). */
  readonly now?: () => number;
  /**
   * Injected timer. Defaults to `setTimeout`; must return a value whose
   * `clear` counterpart is `clearTimer`. Provided for fully deterministic
   * tests, though Vitest fake timers already intercept the global default.
   */
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface DrainOptions {
  /** Grace period to wait for in-flight work to settle. */
  readonly graceMs: number;
  /**
   * Extra slack added on top of `graceMs` before the hard deadline aborts the
   * wait. Lets checkpointing finish even if it started near the grace edge.
   */
  readonly hardDeadlineExtraMs?: number;
  /**
   * When true, checkpoint hooks are invoked concurrently; otherwise serially
   * in iteration order. Defaults to true.
   */
  readonly concurrentCheckpoints?: boolean;
}

export const DEFAULT_DRAIN_GRACE_MS = 25_000;
export const DEFAULT_HARD_DEADLINE_EXTRA_MS = 5_000;

// ─── Accept Gate ──────────────────────────────────────────────────────────

/**
 * A simple boolean gate guarding admission of new work. Starts open
 * (accepting). `close()` is idempotent and one-way for a given drain.
 */
export class AcceptGate {
  private accepting = true;

  isAccepting(): boolean {
    return this.accepting;
  }

  close(): void {
    this.accepting = false;
  }

  /** Re-open the gate (e.g. for tests or aborted drains). */
  open(): void {
    this.accepting = true;
  }
}

// ─── Coordinator ───────────────────────────────────────────────────────────

/**
 * Orchestrates a single graceful drain. Construct once per shutdown attempt.
 * `drain()` is idempotent: subsequent calls return the same in-flight promise.
 */
export class DrainCoordinator {
  private readonly gate = new AcceptGate();
  private readonly hooks: DrainHooks;
  private readonly now: () => number;
  private inProgress: Promise<DrainResult> | null = null;

  constructor(hooks: DrainHooks) {
    this.hooks = hooks;
    this.now = hooks.now ?? Date.now;
  }

  /** Whether new work may still be admitted. */
  isAccepting(): boolean {
    return this.gate.isAccepting();
  }

  /** Whether a drain has been initiated. */
  get draining(): boolean {
    return this.inProgress !== null;
  }

  drain(signal: string, options: DrainOptions): Promise<DrainResult> {
    if (this.inProgress) return this.inProgress;
    this.gate.close();
    this.hooks.onDrainStart?.(signal);
    logger.info({ signal }, "Drain started; accept gate closed");
    this.inProgress = this.run(signal, options);
    return this.inProgress;
  }

  private async run(signal: string, options: DrainOptions): Promise<DrainResult> {
    const startedAt = this.now();
    const runs = Array.from(this.hooks.inFlight());

    const checkpoints = await this.checkpointAll(runs, options.concurrentCheckpoints ?? true);
    const checkpointedIds = new Set(checkpoints.filter((c) => c.ok).map((c) => c.id));

    const graceMs = Math.max(0, options.graceMs);
    const hardExtra = Math.max(0, options.hardDeadlineExtraMs ?? DEFAULT_HARD_DEADLINE_EXTRA_MS);
    const completedIds = await this.waitForRuns(runs, graceMs + hardExtra);

    const runResults: RunResult[] = runs.map((r) => ({
      id: r.id,
      disposition: completedIds.has(r.id) ? "completed" : "abandoned",
      checkpointed: checkpointedIds.has(r.id),
    }));

    const completed = runResults.filter((r) => r.disposition === "completed").length;
    const abandoned = runResults.length - completed;
    const timedOut = abandoned > 0;

    const result: DrainResult = {
      drained: !timedOut,
      timedOut,
      totalRuns: runs.length,
      completed,
      abandoned,
      checkpoints,
      runs: runResults,
      durationMs: this.now() - startedAt,
    };

    logger.info(
      { signal, drained: result.drained, completed, abandoned, totalRuns: runs.length },
      "Drain finished",
    );
    return result;
  }

  private async checkpointAll(
    runs: InFlightRun[],
    concurrent: boolean,
  ): Promise<CheckpointOutcome[]> {
    const one = async (run: InFlightRun): Promise<CheckpointOutcome> => {
      try {
        await this.hooks.checkpoint(run);
        return { id: run.id, ok: true };
      } catch (err) {
        return { id: run.id, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    };

    if (concurrent) {
      return Promise.all(runs.map(one));
    }
    const out: CheckpointOutcome[] = [];
    for (const run of runs) {
      out.push(await one(run));
    }
    return out;
  }

  /**
   * Wait up to `deadlineMs` for runs to settle. Returns the set of run ids that
   * settled before the hard deadline fired. Runs that reject still count as
   * "completed" — they have left the in-flight set.
   */
  private async waitForRuns(runs: InFlightRun[], deadlineMs: number): Promise<Set<string>> {
    const completed = new Set<string>();
    if (runs.length === 0) return completed;

    const setTimer = this.hooks.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clearTimer =
      this.hooks.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

    let timer: unknown;
    const deadline = new Promise<"deadline">((resolve) => {
      timer = setTimer(() => resolve("deadline"), deadlineMs);
    });

    const tracked = runs.map((run) =>
      Promise.resolve(run.done)
        .catch(() => undefined)
        .then(() => {
          completed.add(run.id);
        }),
    );

    const allSettled = Promise.all(tracked).then(() => "settled" as const);
    const outcome = await Promise.race([allSettled, deadline]);
    clearTimer(timer);
    if (outcome === "deadline") {
      logger.warn(
        { deadlineMs, remaining: runs.length - completed.size },
        "Drain hard deadline reached; abandoning remaining runs",
      );
    }
    return completed;
  }
}

/**
 * Convenience one-shot: build a coordinator, run the drain, return the result.
 * The gate is internal; use `DrainCoordinator` directly if the caller needs to
 * consult `isAccepting()` while admitting work.
 */
export function drainInFlight(
  signal: string,
  hooks: DrainHooks,
  options: DrainOptions,
): Promise<DrainResult> {
  return new DrainCoordinator(hooks).drain(signal, options);
}
