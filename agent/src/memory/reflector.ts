// ─── Reflector Agent ────────────────────────────────────────────────────────
// Issue #534 — Periodic reflection / consolidation.
//
// Consolidates accumulated observations (see observer.ts) into compressed
// long-term memories. Reflection is triggered by a count threshold and/or an
// elapsed-time interval; both are configurable. Deduplication reuses dedup.ts
// and summarization is delegated to an injected summarizer fn so this module
// stays free of model/network dependencies.
//
// Additive & non-breaking: the reflector only acts when explicitly fed
// observations and ticked/flushed by the caller. It owns no timers.

import pino from "pino";
import { dedupeRecords, type EmbeddedRecord, type DedupOptions } from "./dedup.js";
import type { Observation } from "./observer.js";
import { withMemoryTypeTag, type MemoryType } from "./memory-types.js";
import type { SaveMemoryInput } from "./store.js";

const logger = pino({ name: "memory-reflector" });

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Summarizer fn: distill a batch of observation contents into one compressed
 * statement. Injectable (LLM-backed). Default is a deterministic join.
 */
export type ReflectionSummarizer = (
  contents: string[],
) => string | Promise<string>;

export interface ReflectorOptions {
  /** Trigger reflection once this many observations accumulate. Default: 10. */
  threshold?: number;
  /**
   * Trigger reflection when this many ms have elapsed since the last reflection
   * (evaluated on {@link Reflector.tick}). 0/undefined disables time-based
   * triggering. Default: disabled.
   */
  intervalMs?: number;
  /** Dedup options applied to observations before summarizing. */
  dedup?: DedupOptions;
  /** Summarizer used to compress a cluster of observations. */
  summarizer?: ReflectionSummarizer;
  /**
   * Memory type stamped on produced memories. Reflections distill events into
   * durable knowledge, so default is "semantic".
   */
  memoryType?: MemoryType;
  /** Reference clock (ms). Injectable for tests. Default: Date.now. */
  now?: () => number;
}

/** A consolidated long-term memory produced by reflection. */
export interface Reflection {
  /** Compressed statement. */
  content: string;
  /** Category derived from the dominant observation kind. */
  category: string;
  /** Union of source observation tags + the memory-type tag. */
  tags: string[];
  /** Max importance across the cluster, in [0,1]. */
  importance: number;
  /** Number of source observations folded into this reflection. */
  sourceCount: number;
  sessionId?: string;
  userId?: string;
}

// ─── Internal record adapter ──────────────────────────────────────────────

interface ObsRecord extends EmbeddedRecord {
  obs: Observation;
}

function defaultSummarizer(contents: string[]): string {
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const c of contents) {
    const k = c.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      uniq.push(c.trim());
    }
  }
  return uniq.join("; ").slice(0, 1000);
}

// ─── Reflector ────────────────────────────────────────────────────────────

/**
 * Accumulates observations and, when triggered, consolidates them into a set of
 * {@link Reflection}s grouped by `kind`. Each group is deduplicated (by
 * embedding/content) and summarized. The reflector is pure with respect to
 * persistence: callers turn reflections into SaveMemoryInput via
 * {@link reflectionToSaveInput} and persist them.
 */
export class Reflector {
  private buffer: Observation[] = [];
  private readonly threshold: number;
  private readonly intervalMs: number;
  private readonly dedup?: DedupOptions;
  private readonly summarizer: ReflectionSummarizer;
  private readonly memoryType: MemoryType;
  private readonly now: () => number;
  private lastReflectedAt: number;

  constructor(options?: ReflectorOptions) {
    this.threshold = Math.max(1, options?.threshold ?? 10);
    this.intervalMs = Math.max(0, options?.intervalMs ?? 0);
    this.dedup = options?.dedup;
    this.summarizer = options?.summarizer ?? defaultSummarizer;
    this.memoryType = options?.memoryType ?? "semantic";
    this.now = options?.now ?? (() => Date.now());
    this.lastReflectedAt = this.now();
  }

  /** Number of buffered observations awaiting reflection. */
  get pending(): number {
    return this.buffer.length;
  }

  /** Add a single observation to the buffer. */
  add(observation: Observation): void {
    this.buffer.push(observation);
  }

  /** Add several observations. */
  addMany(observations: Observation[]): void {
    for (const o of observations) this.buffer.push(o);
  }

  /** True if a count- or time-based trigger condition is currently met. */
  shouldReflect(): boolean {
    if (this.buffer.length === 0) return false;
    if (this.buffer.length >= this.threshold) return true;
    if (this.intervalMs > 0 && this.now() - this.lastReflectedAt >= this.intervalMs) {
      return true;
    }
    return false;
  }

  /**
   * Reflect if a trigger condition is met; returns the produced reflections (or
   * an empty array if not yet triggered). Intended to be called periodically.
   */
  async tick(): Promise<Reflection[]> {
    if (!this.shouldReflect()) return [];
    return this.reflect();
  }

  /**
   * Force consolidation of all buffered observations regardless of triggers.
   * Clears the buffer and resets the interval clock.
   */
  async reflect(): Promise<Reflection[]> {
    if (this.buffer.length === 0) {
      this.lastReflectedAt = this.now();
      return [];
    }

    const batch = this.buffer;
    this.buffer = [];
    this.lastReflectedAt = this.now();

    // Group by observation kind.
    const groups = new Map<Observation["kind"], Observation[]>();
    for (const obs of batch) {
      const arr = groups.get(obs.kind) ?? [];
      arr.push(obs);
      groups.set(obs.kind, arr);
    }

    const reflections: Reflection[] = [];
    for (const [kind, group] of groups) {
      // Dedup within the group (embedding + exact-content).
      const records: ObsRecord[] = group.map((obs, i) => ({
        id: String(i),
        content: obs.content,
        importance: obs.importance,
        tags: obs.tags,
        obs,
      }));
      const { kept } = dedupeRecords(records, this.dedup);

      const contents = kept.map((r) => r.content ?? r.obs.content);
      let content: string;
      try {
        content = await this.summarizer(contents);
      } catch (error) {
        logger.warn({ error: String(error), kind }, "Reflection summarizer failed — using fallback");
        content = defaultSummarizer(contents);
      }
      if (!content || content.trim().length === 0) continue;

      const tags = withMemoryTypeTag(
        Array.from(new Set(group.flatMap((o) => o.tags))),
        this.memoryType,
      );
      const importance = group.reduce((max, o) => Math.max(max, o.importance), 0);

      reflections.push({
        content,
        category: kind,
        tags,
        importance,
        sourceCount: group.length,
        sessionId: group.find((o) => o.sessionId)?.sessionId,
        userId: group.find((o) => o.userId)?.userId,
      });
    }

    if (reflections.length > 0) {
      logger.info(
        { reflections: reflections.length, sourceObservations: batch.length },
        "Reflection consolidated observations",
      );
    }
    return reflections;
  }
}

// ─── Adapters ─────────────────────────────────────────────────────────────

/**
 * Convert a {@link Reflection} into a {@link SaveMemoryInput} for persistence.
 * Importance is mapped onto a coarse priority.
 */
export function reflectionToSaveInput(
  agentId: string,
  reflection: Reflection,
): SaveMemoryInput {
  const priority =
    reflection.importance >= 0.9 ? "high" : reflection.importance <= 0.2 ? "low" : "normal";
  return {
    agentId,
    content: reflection.content,
    summary: reflection.content.slice(0, 500),
    source: "system",
    priority,
    category: reflection.category,
    tags: reflection.tags,
    sessionId: reflection.sessionId,
    userId: reflection.userId,
  };
}
