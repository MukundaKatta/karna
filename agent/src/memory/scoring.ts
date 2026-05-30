// ─── Importance Scoring & Time Decay ───────────────────────────────────────
// Pure heuristics for scoring memory importance, applying exponential time
// decay, and ranking memories by a configurable mix of recency, importance
// and semantic similarity. No external services; deterministic for tests.

import type { MemoryEntry, MemoryPriority } from "@karna/shared/types/memory.js";
import { cosineSimilarity } from "./dedup.js";

// ─── Importance Scoring ─────────────────────────────────────────────────────

/** Base score contribution per priority level, normalized to ~[0,1]. */
function priorityScore(priority: MemoryPriority): number {
  switch (priority) {
    case "critical":
      return 1;
    case "high":
      return 0.75;
    case "normal":
      return 0.5;
    case "low":
    default:
      return 0.25;
  }
}

/**
 * Heuristic importance score in [0, 1] for a memory entry.
 * Mixes priority, access frequency, content richness and explicit decayFactor.
 */
export function scoreImportance(memory: MemoryEntry): number {
  const priority = priorityScore(memory.priority);

  // Access frequency, log-scaled and saturating around ~20 accesses.
  const accessRaw = Math.log1p(Math.max(0, memory.accessCount)) / Math.log1p(20);
  const access = Math.min(1, accessRaw);

  // Content richness: longer/summarized memories tend to carry more signal,
  // saturating around ~500 chars.
  const length = (memory.summary ?? memory.content ?? "").length;
  const richness = Math.min(1, length / 500);

  // Explicit decay factor stored on the entry (defaults to 1).
  const decay = Number.isFinite(memory.decayFactor)
    ? Math.max(0, Math.min(1, memory.decayFactor))
    : 1;

  // Weighted blend, clamped to [0,1].
  const raw = priority * 0.5 + access * 0.25 + richness * 0.15 + decay * 0.1;
  return Math.max(0, Math.min(1, raw));
}

// ─── Time Decay ─────────────────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_HALF_LIFE_MS = 7 * 24 * HOUR_MS; // 7 days

/**
 * Apply exponential time decay to a score.
 * After `halfLifeMs` of age, the score is halved.
 *
 * @param score      The base score (any non-negative number).
 * @param ageMs      Age of the memory in milliseconds (clamped to >= 0).
 * @param halfLifeMs Half-life in ms. Default: 7 days. Non-positive => no decay.
 */
export function applyDecay(
  score: number,
  ageMs: number,
  halfLifeMs: number = DEFAULT_HALF_LIFE_MS,
): number {
  if (halfLifeMs <= 0) return score;
  const age = Math.max(0, ageMs);
  const factor = Math.pow(0.5, age / halfLifeMs);
  return score * factor;
}

/**
 * Recency score in (0, 1] derived from age via exponential decay.
 * age 0 => 1; age == halfLife => 0.5.
 */
export function recencyScore(
  ageMs: number,
  halfLifeMs: number = DEFAULT_HALF_LIFE_MS,
): number {
  return applyDecay(1, ageMs, halfLifeMs);
}

// ─── Ranking ────────────────────────────────────────────────────────────────

export interface RankWeights {
  /** Weight for recency (time decay). Default: 0.3 */
  recency?: number;
  /** Weight for importance heuristic. Default: 0.4 */
  importance?: number;
  /** Weight for semantic similarity to the query. Default: 0.3 */
  similarity?: number;
}

export interface RankOptions {
  weights?: RankWeights;
  /** Query embedding used for the similarity component. Optional. */
  queryEmbedding?: number[];
  /** Half-life for recency decay (ms). Default: 7 days. */
  halfLifeMs?: number;
  /** Reference timestamp (ms). Default: Date.now(). Injectable for tests. */
  now?: number;
}

export interface RankedMemory {
  memory: MemoryEntry;
  score: number;
  components: {
    recency: number;
    importance: number;
    similarity: number;
  };
}

const DEFAULT_WEIGHTS: Required<RankWeights> = {
  recency: 0.3,
  importance: 0.4,
  similarity: 0.3,
};

/**
 * Rank memories by a weighted blend of recency, importance and similarity.
 * Returns a new array sorted by descending combined score (does not mutate
 * the input). When no query embedding is supplied, the similarity weight is
 * dropped and the remaining weights are renormalized so behavior stays sane.
 */
export function rankMemories(
  memories: MemoryEntry[],
  options?: RankOptions,
): RankedMemory[] {
  const now = options?.now ?? Date.now();
  const halfLifeMs = options?.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
  const query = options?.queryEmbedding;
  const hasQuery = Array.isArray(query) && query.length > 0;

  let w: Required<RankWeights> = {
    recency: options?.weights?.recency ?? DEFAULT_WEIGHTS.recency,
    importance: options?.weights?.importance ?? DEFAULT_WEIGHTS.importance,
    similarity: options?.weights?.similarity ?? DEFAULT_WEIGHTS.similarity,
  };

  // Drop similarity when there's no query, then renormalize.
  if (!hasQuery) {
    w = { ...w, similarity: 0 };
  }
  const total = w.recency + w.importance + w.similarity;
  const norm: Required<RankWeights> =
    total > 0
      ? { recency: w.recency / total, importance: w.importance / total, similarity: w.similarity / total }
      : { recency: 0, importance: 0, similarity: 0 };

  const ranked: RankedMemory[] = memories.map((memory) => {
    const recency = recencyScore(now - memory.createdAt, halfLifeMs);
    const importance = scoreImportance(memory);
    let similarity = 0;
    if (hasQuery && memory.embedding && memory.embedding.length > 0) {
      // Map cosine [-1,1] into [0,1].
      similarity = (cosineSimilarity(query!, memory.embedding) + 1) / 2;
    }

    const score =
      recency * norm.recency +
      importance * norm.importance +
      similarity * norm.similarity;

    return { memory, score, components: { recency, importance, similarity } };
  });

  return ranked.sort((a, b) => b.score - a.score);
}
