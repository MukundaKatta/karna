// ─── Context Memory Search ─────────────────────────────────────────────────

import pino from "pino";
import type { MemoryEntry } from "@karna/shared/types/memory.js";
import type { MemoryStore } from "../memory/store.js";
import type { Embedder } from "../memory/embedder.js";
import { semanticSearch, type SearchResult } from "../memory/search.js";

const logger = pino({ name: "context-memory-search" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MemorySearchConfig {
  /** Maximum number of memories to retrieve. */
  limit?: number;
  /** Minimum relevance threshold (0-1). */
  minRelevance?: number;
  /** Weight for similarity vs recency vs priority. */
  weights?: {
    similarity?: number;
    recency?: number;
    priority?: number;
  };
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_RELEVANCE = 0.3;

// ─── Search Function ────────────────────────────────────────────────────────

/**
 * Search for memories relevant to the current conversation context.
 * This is the entry point used by the context builder to inject
 * relevant memories into the agent's context window.
 *
 * @param store - The memory store instance
 * @param agentId - The agent whose memories to search
 * @param query - The user's message or derived search query
 * @param config - Search configuration
 * @param embedder - Optional embedder instance (uses default if not provided)
 */
export async function searchRelevantMemories(
  store: MemoryStore,
  agentId: string,
  query: string,
  config?: MemorySearchConfig,
  embedder?: Embedder
): Promise<MemoryEntry[]> {
  const limit = config?.limit ?? DEFAULT_LIMIT;
  const minRelevance = config?.minRelevance ?? DEFAULT_MIN_RELEVANCE;

  logger.debug({ agentId, query: query.slice(0, 100), limit }, "Searching relevant memories");

  try {
    const results: SearchResult[] = await semanticSearch(
      store,
      agentId,
      query,
      {
        limit,
        minRelevance,
        similarityWeight: config?.weights?.similarity,
        recencyWeight: config?.weights?.recency,
        priorityWeight: config?.weights?.priority,
      },
      embedder
    );

    logger.info(
      {
        agentId,
        resultCount: results.length,
        topScore: results[0]?.combinedScore ?? 0,
      },
      "Memory search completed"
    );

    return results.map((r) => r.memory);
  } catch (error) {
    logger.error({ error, agentId }, "Memory search failed, returning empty results");
    return [];
  }
}
