// ─── Pause / Resume Long-Running Runs (Issue #589) ───────────────────────────
//
// A pure state machine + serializable snapshot for pausing and resuming a
// long-running agent run (e.g. while it waits for tool approval).
//
// State transitions:
//   running  --pause-->  paused
//   paused   --resume--> running
//   running  --complete--> completed
//   running  --fail-->   failed
//   (any non-terminal) --cancel--> cancelled
//
// The controller snapshots only the minimal run state needed to resume: the
// run id, status, an opaque cursor (e.g. loop iteration / step id), arbitrary
// JSON-serializable metadata, and a monotonically increasing version. Snapshots
// are plain objects validated by Zod, so they round-trip through JSON.

import { z } from "zod";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const RunStatusSchema = z.enum([
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunSnapshotSchema = z.object({
  runId: z.string().min(1),
  status: RunStatusSchema,
  /** Opaque resume cursor (e.g. iteration index or step id). */
  cursor: z.union([z.string(), z.number()]).optional(),
  /** Arbitrary JSON-serializable run metadata needed to resume. */
  metadata: z.record(z.unknown()).default({}),
  /** Monotonic version, bumped on every transition. */
  version: z.number().int().nonnegative(),
  /** When this snapshot was produced (epoch ms). */
  updatedAt: z.number().int().nonnegative(),
  /** Optional reason for the most recent transition. */
  reason: z.string().optional(),
});

export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

const TERMINAL: ReadonlySet<RunStatus> = new Set(["completed", "failed", "cancelled"]);

/** Whether a status is terminal (no further transitions allowed). */
export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

export interface PauseResumeOptions {
  /** Clock override for deterministic tests. */
  now?: () => number;
}

/** Raised when an illegal transition is attempted. */
export class InvalidRunTransitionError extends Error {
  constructor(
    public readonly from: RunStatus,
    public readonly to: RunStatus
  ) {
    super(`Invalid run transition: ${from} -> ${to}`);
    this.name = "InvalidRunTransitionError";
  }
}

/**
 * Pure state machine controlling a single run's pause/resume lifecycle.
 *
 * The controller holds the current snapshot; every mutating method returns a new
 * snapshot and updates the internal one. All snapshots are plain serializable
 * objects.
 */
export class RunController {
  private snapshot: RunSnapshot;
  private readonly now: () => number;

  constructor(runId: string, options?: PauseResumeOptions);
  constructor(snapshot: RunSnapshot, options?: PauseResumeOptions);
  constructor(init: string | RunSnapshot, options: PauseResumeOptions = {}) {
    this.now = options.now ?? Date.now;
    if (typeof init === "string") {
      this.snapshot = {
        runId: init,
        status: "running",
        metadata: {},
        version: 0,
        updatedAt: this.now(),
      };
    } else {
      this.snapshot = RunSnapshotSchema.parse(init);
    }
  }

  /** Restore a controller from a (possibly untrusted) serialized snapshot. */
  static fromSnapshot(snapshot: unknown, options: PauseResumeOptions = {}): RunController {
    const parsed = RunSnapshotSchema.parse(snapshot);
    return new RunController(parsed, options);
  }

  /** Current status. */
  get status(): RunStatus {
    return this.snapshot.status;
  }

  /** A copy of the current snapshot (safe to serialize/store). */
  getSnapshot(): RunSnapshot {
    return { ...this.snapshot, metadata: { ...this.snapshot.metadata } };
  }

  /** Whether the run can currently be paused. */
  canPause(): boolean {
    return this.snapshot.status === "running";
  }

  /** Whether the run can currently be resumed. */
  canResume(): boolean {
    return this.snapshot.status === "paused";
  }

  /**
   * Pause a running run, optionally capturing the resume cursor and/or merging
   * additional metadata to persist.
   */
  pause(opts: { cursor?: string | number; metadata?: Record<string, unknown>; reason?: string } = {}): RunSnapshot {
    this.assertTransition("paused");
    return this.transition("paused", opts);
  }

  /**
   * Resume a paused run. Optionally advance/override the cursor and merge
   * metadata.
   */
  resume(opts: { cursor?: string | number; metadata?: Record<string, unknown>; reason?: string } = {}): RunSnapshot {
    this.assertTransition("running");
    return this.transition("running", opts);
  }

  /** Mark the run completed (terminal). */
  complete(opts: { metadata?: Record<string, unknown>; reason?: string } = {}): RunSnapshot {
    this.assertTransition("completed");
    return this.transition("completed", opts);
  }

  /** Mark the run failed (terminal). */
  fail(opts: { metadata?: Record<string, unknown>; reason?: string } = {}): RunSnapshot {
    this.assertTransition("failed");
    return this.transition("failed", opts);
  }

  /** Cancel the run from any non-terminal state (terminal). */
  cancel(opts: { reason?: string } = {}): RunSnapshot {
    this.assertTransition("cancelled");
    return this.transition("cancelled", opts);
  }

  /** Whether a transition to `to` is currently legal. */
  canTransition(to: RunStatus): boolean {
    return isValidTransition(this.snapshot.status, to);
  }

  private assertTransition(to: RunStatus): void {
    if (!isValidTransition(this.snapshot.status, to)) {
      throw new InvalidRunTransitionError(this.snapshot.status, to);
    }
  }

  private transition(
    to: RunStatus,
    opts: { cursor?: string | number; metadata?: Record<string, unknown>; reason?: string }
  ): RunSnapshot {
    this.snapshot = {
      runId: this.snapshot.runId,
      status: to,
      cursor: opts.cursor ?? this.snapshot.cursor,
      metadata: { ...this.snapshot.metadata, ...(opts.metadata ?? {}) },
      version: this.snapshot.version + 1,
      updatedAt: this.now(),
      reason: opts.reason,
    };
    return this.getSnapshot();
  }
}

/** Allowed transitions of the run state machine. */
export function isValidTransition(from: RunStatus, to: RunStatus): boolean {
  if (isTerminal(from)) return false;
  switch (to) {
    case "paused":
      return from === "running";
    case "running":
      return from === "paused";
    case "completed":
    case "failed":
      return from === "running";
    case "cancelled":
      return from === "running" || from === "paused";
    default:
      return false;
  }
}
