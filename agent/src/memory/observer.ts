// ─── Observer Agent ─────────────────────────────────────────────────────────
// Issue #533 — Background observer.
//
// Consumes transcript turns (injected) and extracts structured observations
// out-of-band via a simple async queue. The actual extraction is delegated to
// an injected extractor fn (typically LLM-backed), keeping this module pure and
// testable: no model, network, or timer dependencies are imported here.
//
// Additive & non-breaking: nothing here runs unless explicitly constructed and
// driven by a caller.

import pino from "pino";
import { z } from "zod";

const logger = pino({ name: "memory-observer" });

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single transcript turn fed to the observer. */
export interface TranscriptTurn {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** Epoch ms; defaults to enqueue time when omitted. */
  timestamp?: number;
  sessionId?: string;
  userId?: string;
}

/** Structured observation extracted from one or more turns. */
export const ObservationSchema = z.object({
  /** Short natural-language statement of the observed fact/preference/event. */
  content: z.string().min(1),
  /** Coarse classification, mirrors short-term memory categories plus extras. */
  kind: z
    .enum(["fact", "preference", "task", "event", "entity", "observation"])
    .default("observation"),
  /** Subjective importance in [0,1]. */
  importance: z.number().min(0).max(1).default(0.5),
  /** Free-form tags. */
  tags: z.array(z.string()).default([]),
  /** Optional confidence of the extractor in [0,1]. */
  confidence: z.number().min(0).max(1).optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
});

export type Observation = z.infer<typeof ObservationSchema>;

/**
 * Extractor function: given a batch of turns, returns zero or more raw
 * observations. May be async (LLM-backed) or sync (heuristic). Returned objects
 * are validated/normalized via {@link ObservationSchema} before delivery.
 */
export type ObservationExtractor = (
  turns: TranscriptTurn[],
) => Promise<unknown[]> | unknown[];

/** Sink that receives validated observations. */
export type ObservationSink = (
  observations: Observation[],
) => Promise<void> | void;

export interface ObserverOptions {
  /** Number of turns to accumulate before triggering extraction. Default: 4. */
  batchSize?: number;
  /**
   * Drop turns whose trimmed content is empty. Default: true.
   */
  skipEmpty?: boolean;
  /**
   * Roles to ignore when accumulating (e.g. skip "system"). Default: none.
   */
  ignoreRoles?: TranscriptTurn["role"][];
  /** Optional sink invoked with every validated observation batch. */
  sink?: ObservationSink;
  /**
   * Max turns to retain in the internal queue as a safety valve. When the queue
   * grows beyond this (e.g. extraction is slow), the oldest turns are dropped.
   * Default: 1000.
   */
  maxQueued?: number;
}

// ─── Observer ─────────────────────────────────────────────────────────────

/**
 * Background observer with a simple FIFO async queue. Turns are pushed via
 * {@link observe}; once `batchSize` turns accumulate (or {@link flush} is
 * called) the buffered turns are handed to the extractor. Extraction runs
 * serially (single in-flight drain) so observations preserve transcript order
 * and the extractor never overlaps with itself.
 */
export class Observer {
  private readonly queue: TranscriptTurn[] = [];
  private readonly extractor: ObservationExtractor;
  private readonly batchSize: number;
  private readonly skipEmpty: boolean;
  private readonly ignoreRoles: Set<TranscriptTurn["role"]>;
  private readonly sink?: ObservationSink;
  private readonly maxQueued: number;

  private draining = false;
  private dropped = 0;
  private readonly collected: Observation[] = [];

  constructor(extractor: ObservationExtractor, options?: ObserverOptions) {
    this.extractor = extractor;
    this.batchSize = Math.max(1, options?.batchSize ?? 4);
    this.skipEmpty = options?.skipEmpty ?? true;
    this.ignoreRoles = new Set(options?.ignoreRoles ?? []);
    this.sink = options?.sink;
    this.maxQueued = Math.max(1, options?.maxQueued ?? 1000);
  }

  /** Number of turns currently buffered awaiting extraction. */
  get pending(): number {
    return this.queue.length;
  }

  /** Number of turns dropped due to the {@link ObserverOptions.maxQueued} cap. */
  get droppedCount(): number {
    return this.dropped;
  }

  /**
   * Enqueue a transcript turn. When the buffer reaches `batchSize`, a drain is
   * triggered. Returns the observations produced by any drain that completed
   * synchronously-awaited within this call (always awaited to keep ordering
   * deterministic for callers that await `observe`).
   */
  async observe(turn: TranscriptTurn): Promise<Observation[]> {
    if (this.ignoreRoles.has(turn.role)) return [];
    if (this.skipEmpty && turn.content.trim().length === 0) return [];

    const normalized: TranscriptTurn = {
      ...turn,
      timestamp: turn.timestamp ?? Date.now(),
    };
    this.queue.push(normalized);

    if (this.queue.length > this.maxQueued) {
      const overflow = this.queue.length - this.maxQueued;
      this.queue.splice(0, overflow);
      this.dropped += overflow;
      logger.warn({ overflow, dropped: this.dropped }, "Observer queue overflow — dropping oldest turns");
    }

    if (this.queue.length >= this.batchSize) {
      return this.drain();
    }
    return [];
  }

  /**
   * Force-extract any buffered turns regardless of batch size. Returns the
   * observations produced.
   */
  async flush(): Promise<Observation[]> {
    if (this.queue.length === 0) return [];
    return this.drain(true);
  }

  /**
   * All observations produced over this observer's lifetime, in order. Useful
   * for callers that don't supply a sink.
   */
  getObservations(): Observation[] {
    return [...this.collected];
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private async drain(force = false): Promise<Observation[]> {
    // Single in-flight drain: if one is already running, let it pick up the
    // newly-buffered turns. The caller still gets a (possibly empty) result.
    if (this.draining) return [];
    this.draining = true;

    const produced: Observation[] = [];
    try {
      // Drain in full batches; on force, also flush the remainder.
      while (this.queue.length >= this.batchSize || (force && this.queue.length > 0)) {
        const take = force ? this.queue.length : this.batchSize;
        const batch = this.queue.splice(0, take);

        let raw: unknown[];
        try {
          raw = await this.extractor(batch);
        } catch (error) {
          logger.warn({ error: String(error), batch: batch.length }, "Observation extractor failed");
          continue;
        }

        const validated = this.validate(raw, batch);
        if (validated.length > 0) {
          produced.push(...validated);
          this.collected.push(...validated);
          if (this.sink) {
            try {
              await this.sink(validated);
            } catch (error) {
              logger.warn({ error: String(error) }, "Observation sink failed");
            }
          }
        }
        // After a forced single full-flush, stop.
        if (force) break;
      }
    } finally {
      this.draining = false;
    }

    return produced;
  }

  private validate(raw: unknown[], batch: TranscriptTurn[]): Observation[] {
    const out: Observation[] = [];
    // Fall back to the batch's session/user when the extractor omits them.
    const ctxSession = batch.find((t) => t.sessionId)?.sessionId;
    const ctxUser = batch.find((t) => t.userId)?.userId;

    for (const item of raw) {
      const parsed = ObservationSchema.safeParse(item);
      if (!parsed.success) {
        logger.debug({ issues: parsed.error.issues.length }, "Discarded malformed observation");
        continue;
      }
      out.push({
        ...parsed.data,
        sessionId: parsed.data.sessionId ?? ctxSession,
        userId: parsed.data.userId ?? ctxUser,
      });
    }
    return out;
  }
}
