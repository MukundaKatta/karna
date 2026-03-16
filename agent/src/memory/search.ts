// ─── Semantic Memory Search ────────────────────────────────────────────────

import pino from "pino";
import type { MemoryEntry } from "@karna/shared/types/memory.js";
import type { MemoryStore, ScoredMemory } from "./store.js";
import { generateEmbedding, type Embedder } from "./embedder.js";

const logger = pino({ name: "memory-search" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SemanticSearchOptions {
  /** Maximum number of memories to return. */
  limit?: number;
  /** Minimum similarity score (0-1) to include a result. */
  minRelevance?: number;
  /** Filter by category. */
  category?: string;
  /** Filter by tags (any match). */
  tags?: string[];
  /** Weight for recency scoring (0-1). Higher = prefer recent. */
  recencyWeight?: number;
  /** Weight for priority scoring (0-1). Higher = prefer important. */
  priorityWeight?: number;
  /** Weight for embedding similarity (0-1). */
  similarityWeight?: number;
}

export interface SearchResult {
  memory: MemoryEntry;
  /** Combined score from similarity, recency, and priority. */
  combinedScore: number;
  /** Raw embedding similarity score. */
  similarityScore: number;
  /** Recency contribution to the score. */
  recencyScore: number;
  /** Priority contribution to the score. */
  priorityScore: number;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_RELEVANCE = 0.3;
const DEFAULT_SIMILARITY_WEIGHT = 0.6;
const DEFAULT_RECENCY_WEIGHT = 0.25;
const DEFAULT_PRIORITY_WEIGHT = 0.15;

// ─── Priority Scores ────────────────────────────────────────────────────────

const PRIORITY_SCORES: Record<string, number> = {
  critical: 1.0,
  high: 0.75,
  normal: 0.5,
  low: 0.25,
};

// ─── Semantic Search ────────────────────────────────────────────────────────

/**
 * Search agent memories using a combination of:
 * 1. Embedding similarity (cosine distance via pgvector)
 * 2. Recency (exponential decay based on age)
 * 3. Priority (importance weighting)
 *
 * The combined score is a weighted sum of these three signals.
 */
export async function semanticSearch(
  store: MemoryStore,
  agentId: string,
  query: string,
  options?: SemanticSearchOptions,
  embedder?: Embedder
): Promise<SearchResult[]> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const minRelevance = options?.minRelevance ?? DEFAULT_MIN_RELEVANCE;
  const similarityWeight = options?.similarityWeight ?? DEFAULT_SIMILARITY_WEIGHT;
  const recencyWeight = options?.recencyWeight ?? DEFAULT_RECENCY_WEIGHT;
  const priorityWeight = options?.priorityWeight ?? DEFAULT_PRIORITY_WEIGHT;

  // Generate query embedding
  let queryEmbedding: number[];
  try {
    if (embedder) {
      const result = await embedder.embed(query);
      queryEmbedding = result.embedding;
    } else {
      queryEmbedding = await generateEmbedding(query);
    }
  } catch (error) {
    logger.error({ error, agentId }, "Failed to generate query embedding");
    return [];
  }

  // Fetch candidates from the store (get more than needed for re-ranking)
  const fetchLimit = Math.min(limit * 3, 100);
  const candidates = await store.search({
    agentId,
    embedding: queryEmbedding,
    limit: fetchLimit,
    minRelevance: Math.max(minRelevance - 0.2, 0),
    category: options?.category,
    tags: options?.tags,
  });

  if (candidates.length === 0) {
    return [];
  }

  // Re-rank with combined scoring
  const now = Date.now();
  const results: SearchResult[] = candidates.map((candidate) => {
    const similarityScore = candidate.score;
    const recencyScore = computeRecencyScore(candidate.createdAt, now);
    const priorityScore = PRIORITY_SCORES[candidate.priority] ?? 0.5;

    const combinedScore =
      similarityScore * similarityWeight +
      recencyScore * recencyWeight +
      priorityScore * priorityWeight;

    return {
      memory: candidate,
      combinedScore,
      similarityScore,
      recencyScore,
      priorityScore,
    };
  });

  // Sort by combined score and apply limit
  return results
    .filter((r) => r.combinedScore >= minRelevance)
    .sort((a, b) => b.combinedScore - a.combinedScore)
    .slice(0, limit);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute a recency score using exponential decay.
 * Score = e^(-age / halfLife)
 *
 * Half-life is 7 days: a memory from 7 days ago scores ~0.5.
 */
function computeRecencyScore(createdAt: number, now: number): number {
  const ageMs = now - createdAt;
  const halfLifeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  return Math.exp(-ageMs / halfLifeMs);
}
