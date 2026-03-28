// ─── Agent Pool ───────────────────────────────────────────────────────────────
//
// Manages a pool of AgentRuntime instances with LRU eviction.
// Each agent definition gets its own runtime with dedicated tool registry
// and configuration. The pool prevents unbounded resource consumption.
//
// ──────────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type { AgentDefinition } from "@karna/shared/types/orchestration.js";
import { AgentRuntime, type RuntimeConfig, type StreamCallback } from "../runtime.js";
import { ToolRegistry } from "../tools/registry.js";
import { registerBuiltinTools } from "../tools/builtin/index.js";
import type { ApprovalCallback } from "../tools/approval.js";

const logger = pino({ name: "agent-pool" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PoolEntry {
  /** The agent definition. */
  agentId: string;
  /** The live runtime instance. */
  runtime: AgentRuntime;
  /** The tool registry for this runtime. */
  toolRegistry: ToolRegistry;
  /** The original agent definition config. */
  config: AgentDefinition;
  /** When this entry was created. */
  createdAt: number;
  /** When this entry was last used. */
  lastUsedAt: number;
}

export interface AgentPoolConfig {
  /** Maximum number of agent runtimes in the pool. Default: 10. */
  maxSize?: number;
  /** Default RuntimeConfig to apply to all agents. */
  defaultRuntimeConfig?: RuntimeConfig;
}

const DEFAULT_MAX_SIZE = 10;

// ─── Agent Pool ─────────────────────────────────────────────────────────────

/**
 * A pool of AgentRuntime instances, one per agent definition.
 * Uses LRU eviction when the pool is full.
 */
export class AgentPool {
  private readonly pool = new Map<string, PoolEntry>();
  private readonly maxSize: number;
  private readonly defaultRuntimeConfig: RuntimeConfig;
  private approvalCallback: ApprovalCallback | null = null;
  private streamCallback: StreamCallback | null = null;

  constructor(config?: AgentPoolConfig) {
    this.maxSize = config?.maxSize ?? DEFAULT_MAX_SIZE;
    this.defaultRuntimeConfig = config?.defaultRuntimeConfig ?? {};
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Get an existing runtime or create a new one for the given agent definition.
   * Updates the last-used timestamp on access.
   */
  async getOrCreate(agentConfig: AgentDefinition): Promise<PoolEntry> {
    const existing = this.pool.get(agentConfig.id);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    // Evict LRU entry if pool is full
    if (this.pool.size >= this.maxSize) {
      this.evictLRU();
    }

    // Create a new runtime for this agent
    const toolRegistry = new ToolRegistry();
    registerBuiltinTools(toolRegistry);

    // If the agent definition restricts tools, we apply that at call time via ToolPolicy,
    // not at registration time, so all tools are available but filtered per-agent.

    const runtime = new AgentRuntime(
      toolRegistry,
      undefined,
      undefined,
      {
        ...this.defaultRuntimeConfig,
        autoMemory: false, // Worker agents don't auto-store memories
      }
    );

    await runtime.init();

    // Forward approval and stream callbacks
    if (this.approvalCallback) {
      runtime.setApprovalCallback(this.approvalCallback);
    }
    if (this.streamCallback) {
      runtime.setStreamCallback(this.streamCallback);
    }

    const entry: PoolEntry = {
      agentId: agentConfig.id,
      runtime,
      toolRegistry,
      config: agentConfig,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    this.pool.set(agentConfig.id, entry);
    logger.info(
      { agentId: agentConfig.id, poolSize: this.pool.size },
      "Created agent runtime in pool"
    );

    return entry;
  }

  /**
   * Get a pool entry by agent ID. Returns undefined if not in pool.
   */
  get(agentId: string): PoolEntry | undefined {
    const entry = this.pool.get(agentId);
    if (entry) {
      entry.lastUsedAt = Date.now();
    }
    return entry;
  }

  /**
   * List all pool entries.
   */
  list(): PoolEntry[] {
    return Array.from(this.pool.values());
  }

  /**
   * Remove a specific agent from the pool and stop its runtime.
   */
  async remove(agentId: string): Promise<boolean> {
    const entry = this.pool.get(agentId);
    if (!entry) return false;

    await entry.runtime.stop();
    this.pool.delete(agentId);
    logger.info({ agentId, poolSize: this.pool.size }, "Removed agent from pool");
    return true;
  }

  /**
   * Stop all runtimes and clear the pool.
   */
  async shutdown(): Promise<void> {
    logger.info({ poolSize: this.pool.size }, "Shutting down agent pool");
    const stopPromises = Array.from(this.pool.values()).map((entry) =>
      entry.runtime.stop()
    );
    await Promise.allSettled(stopPromises);
    this.pool.clear();
    logger.info("Agent pool shut down");
  }

  /**
   * Get the current pool size.
   */
  get size(): number {
    return this.pool.size;
  }

  /**
   * Set the approval callback for all current and future runtimes.
   */
  setApprovalCallback(callback: ApprovalCallback): void {
    this.approvalCallback = callback;
    for (const entry of this.pool.values()) {
      entry.runtime.setApprovalCallback(callback);
    }
  }

  /**
   * Set the stream callback for all current and future runtimes.
   */
  setStreamCallback(callback: StreamCallback): void {
    this.streamCallback = callback;
    for (const entry of this.pool.values()) {
      entry.runtime.setStreamCallback(callback);
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /**
   * Evict the least recently used entry from the pool.
   */
  private evictLRU(): void {
    let oldest: PoolEntry | null = null;
    for (const entry of this.pool.values()) {
      if (!oldest || entry.lastUsedAt < oldest.lastUsedAt) {
        oldest = entry;
      }
    }

    if (oldest) {
      logger.info(
        { agentId: oldest.agentId, lastUsedAt: oldest.lastUsedAt },
        "Evicting LRU agent from pool"
      );
      // Stop asynchronously but don't await — eviction is best-effort cleanup
      oldest.runtime.stop().catch((error) => {
        logger.warn({ agentId: oldest!.agentId, error: String(error) }, "Error stopping evicted runtime");
      });
      this.pool.delete(oldest.agentId);
    }
  }
}
