// ─── Memory Manager ──────────────────────────────────────────────────────────
// Orchestrates the 3-tier memory system:
// 1. Working memory (in-process, per-conversation)
// 2. Short-term memory (session-scoped, TTL-based)
// 3. Long-term memory (persistent, pgvector)

import pino from "pino";
import { WorkingMemory, type WorkingMemoryMessage } from "./working.js";
import { ShortTermMemory, type ShortTermEntry } from "./short-term.js";
import { MemoryStore, type SaveMemoryInput, type MemorySearchParams, type ScoredMemory } from "./store.js";
import type { MemoryEntry } from "@karna/shared/types/memory.js";

const logger = pino({ name: "memory-manager" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemoryManagerOptions {
  /** Maximum token budget for working memory. */
  workingMemoryMaxTokens?: number;
  /** Default TTL for short-term memory in ms. */
  shortTermTtlMs?: number;
  /** Importance threshold for promoting short-term to long-term. Default: 0.7 */
  promotionThreshold?: number;
  /** Maximum number of long-term memories to keep per agent. */
  maxLongTermMemoriesPerAgent?: number;
  /** Run long-term maintenance on an interval when enabled. */
  maintenanceIntervalMs?: number;
}

export interface MemoryContext {
  workingSummary: string | null;
  workingMessages: WorkingMemoryMessage[];
  shortTermContext: string;
  longTermMemories: ScoredMemory[];
}

// ─── Memory Manager ────────────────────────────────────────────────────────

export class MemoryManager {
  private readonly workingMemories = new Map<string, WorkingMemory>();
  private readonly shortTerm: ShortTermMemory;
  private readonly longTerm: MemoryStore | null;
  private readonly promotionThreshold: number;
  private readonly workingMemoryMaxTokens: number;
  private readonly maxLongTermMemoriesPerAgent: number | null;
  private readonly knownAgentIds = new Set<string>();
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;

  constructor(longTermStore: MemoryStore | null, options?: MemoryManagerOptions) {
    this.longTerm = longTermStore;
    this.promotionThreshold = options?.promotionThreshold ?? 0.7;
    this.workingMemoryMaxTokens = options?.workingMemoryMaxTokens ?? 100_000;
    this.maxLongTermMemoriesPerAgent = options?.maxLongTermMemoriesPerAgent ?? null;
    this.shortTerm = new ShortTermMemory({
      defaultTtlMs: options?.shortTermTtlMs,
    });

    if (this.longTerm && options?.maintenanceIntervalMs) {
      this.maintenanceTimer = setInterval(() => {
        this.runMaintenance().catch((error) => {
          logger.warn({ error: String(error) }, "Long-term memory maintenance failed");
        });
      }, options.maintenanceIntervalMs);
      this.maintenanceTimer.unref();
    }
  }

  // ─── Working Memory ─────────────────────────────────────────────────────

  /**
   * Get or create working memory for a session.
   */
  getWorkingMemory(sessionId: string): WorkingMemory {
    let wm = this.workingMemories.get(sessionId);
    if (!wm) {
      wm = new WorkingMemory({ maxTokens: this.workingMemoryMaxTokens });
      this.workingMemories.set(sessionId, wm);
    }
    return wm;
  }

  /**
   * Add a message to working memory.
   */
  addMessage(sessionId: string, message: WorkingMemoryMessage): void {
    this.getWorkingMemory(sessionId).addMessage(message);
  }

  // ─── Short-Term Memory ──────────────────────────────────────────────────

  /**
   * Store a short-term observation.
   */
  storeObservation(
    sessionId: string,
    content: string,
    category: ShortTermEntry["category"] = "observation",
    importance = 0.5,
    tags: string[] = [],
  ): ShortTermEntry {
    return this.shortTerm.store({
      sessionId,
      content,
      category,
      importance,
      tags,
    });
  }

  /**
   * Store a tool result in short-term memory.
   */
  storeToolResult(
    sessionId: string,
    toolName: string,
    result: string,
    importance = 0.6,
  ): ShortTermEntry {
    return this.shortTerm.store({
      sessionId,
      content: result,
      category: "tool_result",
      importance,
      tags: [toolName],
      metadata: { toolName },
    });
  }

  // ─── Long-Term Memory ───────────────────────────────────────────────────

  /**
   * Save to long-term memory.
   */
  async saveLongTerm(input: SaveMemoryInput): Promise<MemoryEntry | null> {
    if (!this.longTerm) {
      logger.debug("Long-term memory not available — skipping save");
      return null;
    }
    this.knownAgentIds.add(input.agentId);
    return this.longTerm.save(input);
  }

  /**
   * Search long-term memory.
   */
  async searchLongTerm(params: MemorySearchParams): Promise<ScoredMemory[]> {
    if (!this.longTerm) return [];
    return this.longTerm.search(params);
  }

  // ─── Unified Context ────────────────────────────────────────────────────

  /**
   * Get a unified memory context for the agent, combining all 3 tiers.
   */
  async getContext(
    sessionId: string,
    queryEmbedding?: number[],
    agentId?: string,
  ): Promise<MemoryContext> {
    const wm = this.getWorkingMemory(sessionId);
    const { summary, messages } = wm.getContextWindow();

    const shortTermContext = this.shortTerm.getContextForSession(sessionId, 15);

    let longTermMemories: ScoredMemory[] = [];
    if (this.longTerm && queryEmbedding && agentId) {
      try {
        longTermMemories = await this.longTerm.search({
          agentId,
          embedding: queryEmbedding,
          limit: 10,
        });
      } catch (error) {
        logger.warn({ error: String(error) }, "Long-term memory search failed");
      }
    }

    return {
      workingSummary: summary,
      workingMessages: messages,
      shortTermContext,
      longTermMemories,
    };
  }

  // ─── Promotion ──────────────────────────────────────────────────────────

  /**
   * Promote high-importance short-term entries to long-term memory.
   * Called periodically or at session end.
   */
  async promoteToLongTerm(sessionId: string, agentId: string): Promise<number> {
    if (!this.longTerm) return 0;
    this.knownAgentIds.add(agentId);

    const entries = this.shortTerm.getForSession(sessionId);
    const toPromote = entries.filter((e) => e.importance >= this.promotionThreshold);

    let promoted = 0;
    for (const entry of toPromote) {
      try {
        await this.longTerm.save({
          agentId,
          content: entry.content,
          source: "conversation",
          priority: entry.importance >= 0.9 ? "high" : "normal",
          tags: entry.tags,
          category: entry.category,
          sessionId,
        });
        promoted++;
      } catch (error) {
        logger.warn(
          { error: String(error), entryId: entry.id },
          "Failed to promote entry to long-term memory",
        );
      }
    }

    if (promoted > 0) {
      logger.info({ sessionId, promoted, total: toPromote.length }, "Promoted entries to long-term memory");
    }

    return promoted;
  }

  /**
   * Consolidate related long-term memories for an agent into a single summary memory.
   */
  async consolidateLongTerm(agentId: string): Promise<number> {
    if (!this.longTerm) return 0;

    const memories = await this.longTerm.listByAgent(agentId);
    const groups = new Map<string, MemoryEntry[]>();

    for (const memory of memories) {
      if (memory.tags.includes("consolidated")) continue;
      const key = `${memory.sessionId ?? "global"}::${memory.category ?? "general"}`;
      const group = groups.get(key) ?? [];
      group.push(memory);
      groups.set(key, group);
    }

    let consolidatedGroups = 0;
    for (const [, group] of groups) {
      if (group.length < 2) continue;

      const ordered = group.sort((a, b) => a.createdAt - b.createdAt).slice(0, 5);
      const combinedContent = ordered
        .map((memory) => memory.summary ?? memory.content)
        .join("\n- ");

      await this.longTerm.save({
        agentId,
        content: `Consolidated memory:\n- ${combinedContent}`,
        summary: ordered.map((memory) => memory.summary ?? memory.content).join("; ").slice(0, 500),
        source: "system",
        priority: "high",
        category: ordered[0]?.category,
        sessionId: ordered[0]?.sessionId,
        tags: Array.from(new Set([...ordered.flatMap((memory) => memory.tags), "consolidated"])),
      });

      await Promise.all(ordered.map((memory) => this.longTerm!.delete(memory.id)));
      consolidatedGroups++;
    }

    if (consolidatedGroups > 0) {
      logger.info({ agentId, consolidatedGroups }, "Consolidated long-term memories");
    }

    return consolidatedGroups;
  }

  /**
   * Enforce retention rules for long-term memory.
   */
  async enforceRetention(agentId: string): Promise<number> {
    if (!this.longTerm) return 0;

    const memories = await this.longTerm.listByAgent(agentId);
    const now = Date.now();
    let deleted = 0;

    for (const memory of memories) {
      if (memory.expiresAt && memory.expiresAt <= now) {
        if (await this.longTerm.delete(memory.id)) deleted++;
      }
    }

    if (this.maxLongTermMemoriesPerAgent) {
      const remaining = (await this.longTerm.listByAgent(agentId))
        .sort((a, b) => b.accessedAt - a.accessedAt);
      const overflow = remaining.slice(this.maxLongTermMemoriesPerAgent);

      for (const memory of overflow) {
        if (await this.longTerm.delete(memory.id)) deleted++;
      }
    }

    if (deleted > 0) {
      logger.info({ agentId, deleted }, "Applied long-term memory retention");
    }

    return deleted;
  }

  /**
   * Run consolidation and retention for all known agents.
   */
  async runMaintenance(): Promise<void> {
    for (const agentId of this.knownAgentIds) {
      await this.consolidateLongTerm(agentId);
      await this.enforceRetention(agentId);
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Clean up session resources.
   */
  async endSession(sessionId: string, agentId?: string): Promise<void> {
    // Promote important short-term memories before clearing
    if (agentId) {
      await this.promoteToLongTerm(sessionId, agentId);
    }

    this.workingMemories.delete(sessionId);
    this.shortTerm.clearSession(sessionId);

    logger.debug({ sessionId }, "Session memory cleaned up");
  }

  /**
   * Stop all background timers.
   */
  stop(): void {
    this.shortTerm.stop();
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
  }
}
