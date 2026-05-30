// ─── Run Checkpoint / Snapshot Recovery (#524) ────────────────────────────────
//
// Serializable snapshots of an in-flight agent run. A RunCheckpoint captures
// enough state — the rebuilt context, the plan, partial tool results, and the
// loop cursor — to reconstruct and resume a run after a crash or restart.
//
// This module is intentionally pure and decoupled from AgentRuntime: it defines
// the checkpoint shape, a Zod schema for validation, (de)serialization helpers,
// a CheckpointStore interface with in-memory and JSONL-file implementations,
// a configurable checkpoint-interval helper, and a resume reconstructor.
//
// ───────────────────────────────────────────────────────────────────────────

import { appendFile, readFile, mkdir, readdir, unlink, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import pino from "pino";

const logger = pino({ name: "agent-checkpoint" });

// ─── Schema ───────────────────────────────────────────────────────────────

/** A single chat message as carried inside a checkpoint. Mirrors the runtime
 * `ChatMessage` shape (see agent/src/models/provider.ts) but is validated here
 * so checkpoints can be safely round-tripped from disk. */
export const CheckpointToolUseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.record(z.unknown()),
});

export const CheckpointMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  toolUses: z.array(CheckpointToolUseSchema).optional(),
});

/** A partial/complete tool result recorded mid-run. */
export const CheckpointToolResultSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.record(z.unknown()),
  output: z.unknown(),
  isError: z.boolean(),
  errorMessage: z.string().optional(),
  errorCode: z.string().optional(),
  durationMs: z.number().nonnegative(),
  approved: z.boolean(),
});

/** An optional high-level plan attached to a run (one entry per planned step). */
export const CheckpointPlanStepSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  status: z.enum(["pending", "in_progress", "done", "skipped", "failed"]),
});

export const CheckpointCursorSchema = z.object({
  /** Current tool-loop iteration (1-based, matching AgentRuntime). */
  iteration: z.number().int().nonnegative(),
  /** Maximum tool-loop iterations for this run. */
  maxIterations: z.number().int().positive(),
  /** Index of the next plan step to execute, if a plan is present. */
  planStep: z.number().int().nonnegative().optional(),
  /** Whether the run has produced its final response. */
  completed: z.boolean(),
});

export const RunCheckpointSchema = z.object({
  /** Schema version for forward-compatible migrations. */
  version: z.literal(1),
  /** Unique checkpoint id. */
  id: z.string().min(1),
  /** The run this checkpoint belongs to. */
  runId: z.string().min(1),
  /** The session this run is part of. */
  sessionId: z.string().min(1),
  /** The agent persona id driving the run. */
  agentId: z.string().min(1),
  /** When this checkpoint was taken (epoch ms). */
  createdAt: z.number().int().positive(),
  /** The system prompt in effect for the run. */
  systemPrompt: z.string(),
  /** The model selected for the run. */
  model: z.string(),
  /** Full reconstructable context: the running message array. */
  context: z.array(CheckpointMessageSchema),
  /** Optional plan steps. */
  plan: z.array(CheckpointPlanStepSchema),
  /** Partial tool results accumulated so far. */
  partialToolResults: z.array(CheckpointToolResultSchema),
  /** Loop cursor. */
  cursor: CheckpointCursorSchema,
  /** Accumulated token usage so far. */
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  /** Accumulated response text so far (may be partial). */
  partialResponse: z.string(),
});

export type CheckpointToolUse = z.infer<typeof CheckpointToolUseSchema>;
export type CheckpointMessage = z.infer<typeof CheckpointMessageSchema>;
export type CheckpointToolResult = z.infer<typeof CheckpointToolResultSchema>;
export type CheckpointPlanStep = z.infer<typeof CheckpointPlanStepSchema>;
export type CheckpointCursor = z.infer<typeof CheckpointCursorSchema>;
export type RunCheckpoint = z.infer<typeof RunCheckpointSchema>;

export const CHECKPOINT_VERSION = 1 as const;

// ─── Serialization ──────────────────────────────────────────────────────────

/**
 * Serialize a checkpoint to a single-line JSON string (validated first).
 * Throws if the checkpoint does not satisfy {@link RunCheckpointSchema}.
 */
export function serializeCheckpoint(checkpoint: RunCheckpoint): string {
  const validated = RunCheckpointSchema.parse(checkpoint);
  return JSON.stringify(validated);
}

/**
 * Parse and validate a checkpoint from a JSON string.
 * Throws (via Zod) if the payload is malformed or fails validation.
 */
export function deserializeCheckpoint(raw: string): RunCheckpoint {
  const parsed: unknown = JSON.parse(raw);
  return RunCheckpointSchema.parse(parsed);
}

/**
 * Validate an unknown value as a RunCheckpoint without throwing.
 * Returns the parsed checkpoint or null.
 */
export function safeParseCheckpoint(value: unknown): RunCheckpoint | null {
  const result = RunCheckpointSchema.safeParse(value);
  return result.success ? result.data : null;
}

// ─── Resume Reconstruction ────────────────────────────────────────────────

/** The in-flight run state reconstructed from a checkpoint, ready to resume. */
export interface ResumedRunState {
  runId: string;
  sessionId: string;
  agentId: string;
  systemPrompt: string;
  model: string;
  /** The message array to feed back into the model loop. */
  messages: CheckpointMessage[];
  plan: CheckpointPlanStep[];
  toolResults: CheckpointToolResult[];
  /** The iteration to resume from (the next iteration to run). */
  iteration: number;
  maxIterations: number;
  planStep: number;
  completed: boolean;
  usage: { inputTokens: number; outputTokens: number };
  partialResponse: string;
  /** True when the checkpoint indicates there is more work to do. */
  resumable: boolean;
}

/**
 * Reconstruct in-flight run state from a checkpoint so a runner can resume.
 *
 * The returned `messages` array includes the persisted context plus synthetic
 * tool-result messages for any partial tool results that were not already
 * folded into the context — guaranteeing the model sees every tool answer when
 * the loop continues.
 */
export function resumeFromCheckpoint(checkpoint: RunCheckpoint): ResumedRunState {
  const messages: CheckpointMessage[] = [...checkpoint.context];

  // Determine which tool results are already represented in the context to
  // avoid double-feeding them when resuming.
  const presentToolCallIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId) {
      presentToolCallIds.add(message.toolCallId);
    }
  }

  for (const result of checkpoint.partialToolResults) {
    if (presentToolCallIds.has(result.id)) continue;
    messages.push({
      role: "tool",
      content: JSON.stringify(
        result.isError
          ? { error: result.errorMessage, code: result.errorCode }
          : result.output,
      ),
      toolCallId: result.id,
      toolName: result.name,
    });
  }

  const resumable =
    !checkpoint.cursor.completed &&
    checkpoint.cursor.iteration < checkpoint.cursor.maxIterations;

  return {
    runId: checkpoint.runId,
    sessionId: checkpoint.sessionId,
    agentId: checkpoint.agentId,
    systemPrompt: checkpoint.systemPrompt,
    model: checkpoint.model,
    messages,
    plan: [...checkpoint.plan],
    toolResults: [...checkpoint.partialToolResults],
    iteration: checkpoint.cursor.iteration,
    maxIterations: checkpoint.cursor.maxIterations,
    planStep: checkpoint.cursor.planStep ?? 0,
    completed: checkpoint.cursor.completed,
    usage: { ...checkpoint.usage },
    partialResponse: checkpoint.partialResponse,
    resumable,
  };
}

// ─── Checkpoint Interval Helper ─────────────────────────────────────────────

export interface CheckpointIntervalOptions {
  /** Take a checkpoint every N iterations (default 1 — every iteration). */
  everyIterations?: number;
  /** Also take a checkpoint when at least this many ms elapsed since the last. */
  everyMs?: number;
}

/**
 * A small stateful helper that decides when a run should persist a checkpoint.
 * It is fully deterministic given the inputs supplied to {@link shouldCheckpoint}.
 *
 * @example
 * ```ts
 * const cadence = new CheckpointInterval({ everyIterations: 2 });
 * if (cadence.shouldCheckpoint(iteration, Date.now())) await store.save(cp);
 * ```
 */
export class CheckpointInterval {
  private readonly everyIterations: number;
  private readonly everyMs: number | null;
  private lastIteration = -1;
  private lastTimeMs: number | null = null;

  constructor(options: CheckpointIntervalOptions = {}) {
    const everyIterations = options.everyIterations ?? 1;
    if (!Number.isInteger(everyIterations) || everyIterations < 1) {
      throw new Error("everyIterations must be a positive integer");
    }
    this.everyIterations = everyIterations;
    if (options.everyMs !== undefined) {
      if (!Number.isFinite(options.everyMs) || options.everyMs <= 0) {
        throw new Error("everyMs must be a positive number");
      }
      this.everyMs = options.everyMs;
    } else {
      this.everyMs = null;
    }
  }

  /**
   * Returns true if a checkpoint should be taken at the given iteration/time.
   * Calling this with `true` records the decision so subsequent calls space out
   * correctly.
   */
  shouldCheckpoint(iteration: number, nowMs: number = Date.now()): boolean {
    let take = false;

    if (this.lastIteration < 0) {
      // Always checkpoint the very first observed iteration.
      take = true;
    } else if (iteration - this.lastIteration >= this.everyIterations) {
      take = true;
    } else if (
      this.everyMs !== null &&
      this.lastTimeMs !== null &&
      nowMs - this.lastTimeMs >= this.everyMs
    ) {
      take = true;
    }

    if (take) {
      this.lastIteration = iteration;
      this.lastTimeMs = nowMs;
    }

    return take;
  }

  /** Reset the cadence state (e.g. when starting a new run). */
  reset(): void {
    this.lastIteration = -1;
    this.lastTimeMs = null;
  }
}

// ─── CheckpointStore ────────────────────────────────────────────────────────

/**
 * Persistence interface for run checkpoints. Implementations should store the
 * latest checkpoint per `runId` and support listing for recovery scans.
 */
export interface CheckpointStore {
  /** Persist (overwrite) the checkpoint for its run. */
  save(checkpoint: RunCheckpoint): Promise<void>;
  /** Load the latest checkpoint for a run, or null if none. */
  load(runId: string): Promise<RunCheckpoint | null>;
  /** List the run ids that currently have a checkpoint. */
  list(): Promise<string[]>;
  /** Remove the checkpoint(s) for a run. Returns true if anything was removed. */
  delete(runId: string): Promise<boolean>;
}

// ─── In-Memory Implementation ───────────────────────────────────────────────

/**
 * In-memory checkpoint store. Useful for tests and ephemeral runs.
 * Stores a defensively-cloned copy keyed by runId.
 */
export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly checkpoints = new Map<string, RunCheckpoint>();

  async save(checkpoint: RunCheckpoint): Promise<void> {
    // Validate + clone via the schema so callers cannot mutate stored state.
    const validated = RunCheckpointSchema.parse(checkpoint);
    this.checkpoints.set(validated.runId, validated);
  }

  async load(runId: string): Promise<RunCheckpoint | null> {
    const found = this.checkpoints.get(runId);
    if (!found) return null;
    // Return a clone so mutation by callers does not affect the stored copy.
    return RunCheckpointSchema.parse(found);
  }

  async list(): Promise<string[]> {
    return Array.from(this.checkpoints.keys());
  }

  async delete(runId: string): Promise<boolean> {
    return this.checkpoints.delete(runId);
  }

  /** Number of runs with a stored checkpoint. */
  get size(): number {
    return this.checkpoints.size;
  }

  /** Drop all stored checkpoints. */
  clear(): void {
    this.checkpoints.clear();
  }
}

// ─── JSONL File Implementation ──────────────────────────────────────────────

export interface FileCheckpointStoreOptions {
  /** Directory in which to store per-run JSONL files. */
  dir: string;
}

/**
 * File-backed checkpoint store using append-only JSONL, one file per run
 * (`<runId>.jsonl`). Each `save` appends a line; the most recent valid line is
 * the active checkpoint. This append-only design is crash-safe: a partially
 * written final line is simply ignored on load, and the previous checkpoint
 * remains recoverable.
 *
 * A compaction step rewrites the file to a single line once it grows beyond a
 * threshold, keeping reads cheap without losing the latest state.
 */
export class FileCheckpointStore implements CheckpointStore {
  private readonly dir: string;
  private readonly maxLinesBeforeCompact = 64;

  constructor(options: FileCheckpointStoreOptions) {
    this.dir = options.dir;
  }

  private safeRunId(runId: string): string {
    return runId.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private pathFor(runId: string): string {
    return join(this.dir, `${this.safeRunId(runId)}.jsonl`);
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, { recursive: true });
    }
  }

  async save(checkpoint: RunCheckpoint): Promise<void> {
    await this.ensureDir();
    const filePath = this.pathFor(checkpoint.runId);
    const line = serializeCheckpoint(checkpoint) + "\n";
    await appendFile(filePath, line, "utf-8");
    await this.compactIfNeeded(filePath, checkpoint);
  }

  private async compactIfNeeded(
    filePath: string,
    latest: RunCheckpoint,
  ): Promise<void> {
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      return;
    }
    const lineCount = content.split("\n").filter(Boolean).length;
    if (lineCount <= this.maxLinesBeforeCompact) return;

    const tmpPath = `${filePath}.tmp`;
    await appendFile(tmpPath, serializeCheckpoint(latest) + "\n", "utf-8").catch(
      () => undefined,
    );
    try {
      await rename(tmpPath, filePath);
      logger.debug({ filePath, lineCount }, "Compacted checkpoint file");
    } catch (error) {
      logger.warn({ error: String(error), filePath }, "Checkpoint compaction failed");
      await unlink(tmpPath).catch(() => undefined);
    }
  }

  async load(runId: string): Promise<RunCheckpoint | null> {
    const filePath = this.pathFor(runId);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return null;
      throw error;
    }

    const lines = content.split("\n").filter(Boolean);
    // Walk backwards to find the most recent valid checkpoint line.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      try {
        return deserializeCheckpoint(line);
      } catch {
        // Ignore a malformed (e.g. partially written) line and try the prior one.
        continue;
      }
    }
    return null;
  }

  async list(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    const files = await readdir(this.dir);
    const runIds: string[] = [];
    for (const fileName of files) {
      if (!fileName.endsWith(".jsonl")) continue;
      const checkpoint = await this.load(fileName.slice(0, -".jsonl".length));
      if (checkpoint) runIds.push(checkpoint.runId);
    }
    return runIds;
  }

  async delete(runId: string): Promise<boolean> {
    const filePath = this.pathFor(runId);
    if (!existsSync(filePath)) return false;
    try {
      await unlink(filePath);
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return false;
      throw error;
    }
  }
}
