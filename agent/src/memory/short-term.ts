// ─── Short-Term Memory ───────────────────────────────────────────────────────
// Session-scoped memory with TTL. Stores recent conversation summaries,
// tool results, and observations from the current session.
// Backed by Redis when available, falls back to in-memory.

import pino from "pino";

const logger = pino({ name: "short-term-memory" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShortTermEntry {
  id: string;
  sessionId: string;
  content: string;
  category: "summary" | "tool_result" | "observation" | "fact";
  importance: number; // 0-1 scale
  createdAt: number;
  expiresAt: number;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface ShortTermMemoryOptions {
  /** Default TTL for entries in milliseconds. Default: 4 hours. */
  defaultTtlMs?: number;
  /** Maximum number of entries per session. Default: 200. */
  maxEntriesPerSession?: number;
  /** Cleanup interval in milliseconds. Default: 60 seconds. */
  cleanupIntervalMs?: number;
}

// ─── Short-Term Memory ─────────────────────────────────────────────────────

export class ShortTermMemory {
  private readonly entries = new Map<string, ShortTermEntry>();
  private readonly sessionIndex = new Map<string, Set<string>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntriesPerSession: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private counter = 0;

  constructor(options?: ShortTermMemoryOptions) {
    this.defaultTtlMs = options?.defaultTtlMs ?? 4 * 60 * 60 * 1000;
    this.maxEntriesPerSession = options?.maxEntriesPerSession ?? 200;
    this.startCleanup(options?.cleanupIntervalMs ?? 60_000);
  }

  /**
   * Store an entry in short-term memory.
   */
  store(params: {
    sessionId: string;
    content: string;
    category: ShortTermEntry["category"];
    importance?: number;
    ttlMs?: number;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): ShortTermEntry {
    const now = Date.now();
    const id = `stm_${++this.counter}_${now}`;

    const entry: ShortTermEntry = {
      id,
      sessionId: params.sessionId,
      content: params.content,
      category: params.category,
      importance: params.importance ?? 0.5,
      createdAt: now,
      expiresAt: now + (params.ttlMs ?? this.defaultTtlMs),
      tags: params.tags ?? [],
      metadata: params.metadata,
    };

    this.entries.set(id, entry);

    // Update session index
    let sessionEntries = this.sessionIndex.get(params.sessionId);
    if (!sessionEntries) {
      sessionEntries = new Set();
      this.sessionIndex.set(params.sessionId, sessionEntries);
    }
    sessionEntries.add(id);

    // Evict lowest-importance entries if over limit
    if (sessionEntries.size > this.maxEntriesPerSession) {
      this.evictLowestImportance(params.sessionId);
    }

    logger.debug(
      { id, sessionId: params.sessionId, category: params.category },
      "Short-term memory stored",
    );

    return entry;
  }

  /**
   * Retrieve all entries for a session, optionally filtered.
   */
  getForSession(
    sessionId: string,
    options?: { category?: ShortTermEntry["category"]; tags?: string[]; limit?: number },
  ): ShortTermEntry[] {
    const entryIds = this.sessionIndex.get(sessionId);
    if (!entryIds) return [];

    const now = Date.now();
    let results: ShortTermEntry[] = [];

    for (const id of entryIds) {
      const entry = this.entries.get(id);
      if (!entry || now > entry.expiresAt) continue;

      if (options?.category && entry.category !== options.category) continue;
      if (options?.tags && options.tags.length > 0) {
        const tagSet = new Set(options.tags);
        if (!entry.tags.some((t) => tagSet.has(t))) continue;
      }

      results.push(entry);
    }

    // Sort by importance (descending), then recency
    results.sort((a, b) => b.importance - a.importance || b.createdAt - a.createdAt);

    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get a formatted context string for the LLM from session entries.
   */
  getContextForSession(sessionId: string, maxEntries = 20): string {
    const entries = this.getForSession(sessionId, { limit: maxEntries });
    if (entries.length === 0) return "";

    const lines = entries.map((e) => {
      const tags = e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : "";
      return `- [${e.category}${tags}] ${e.content}`;
    });

    return `Recent session context:\n${lines.join("\n")}`;
  }

  /**
   * Clear all entries for a session.
   */
  clearSession(sessionId: string): number {
    const entryIds = this.sessionIndex.get(sessionId);
    if (!entryIds) return 0;

    let cleared = 0;
    for (const id of entryIds) {
      this.entries.delete(id);
      cleared++;
    }
    this.sessionIndex.delete(sessionId);

    logger.debug({ sessionId, cleared }, "Short-term memory cleared for session");
    return cleared;
  }

  /**
   * Stop the cleanup timer.
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Get total entry count.
   */
  get size(): number {
    return this.entries.size;
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private startCleanup(intervalMs: number): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
    this.cleanupTimer.unref();
  }

  private cleanup(): void {
    const now = Date.now();
    let expired = 0;

    for (const [id, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(id);
        const sessionEntries = this.sessionIndex.get(entry.sessionId);
        sessionEntries?.delete(id);
        expired++;
      }
    }

    if (expired > 0) {
      logger.debug({ expired }, "Short-term memory cleanup");
    }
  }

  private evictLowestImportance(sessionId: string): void {
    const entryIds = this.sessionIndex.get(sessionId);
    if (!entryIds) return;

    let lowestId: string | null = null;
    let lowestImportance = Infinity;

    for (const id of entryIds) {
      const entry = this.entries.get(id);
      if (entry && entry.importance < lowestImportance) {
        lowestImportance = entry.importance;
        lowestId = id;
      }
    }

    if (lowestId) {
      this.entries.delete(lowestId);
      entryIds.delete(lowestId);
    }
  }
}
