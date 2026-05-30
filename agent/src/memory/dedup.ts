// ─── Semantic Memory Dedup ───────────────────────────────────────────────────
// Issue #536 — Semantic dedup of memories.
//
// Self-contained cosine-similarity helpers plus duplicate detection and a merge
// helper for collapsing near-identical memories. Math is kept dependency-free so
// it can run in any environment (tests, edge, browser). The embedder is reused
// when callers already have embeddings; this module never *generates* embeddings.
//
// Additive & non-breaking: nothing here runs unless explicitly invoked.

import pino from "pino";

const logger = pino({ name: "memory-dedup" });

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Minimal structural shape required for dedup. Compatible with `MemoryEntry`
 * and `ShortTermEntry`, but intentionally narrow so any record carrying an
 * embedding (and optionally content/timestamps) can be deduplicated.
 */
export interface EmbeddedRecord {
  id?: string;
  content?: string;
  embedding?: number[] | null;
  /** Higher wins when merging. Falls back to 0. */
  importance?: number;
  /** Epoch ms. Used as a tiebreaker when merging (newer wins). */
  createdAt?: number;
  tags?: string[];
}

export interface DuplicateMatch<T extends EmbeddedRecord> {
  /** The existing record that matched. */
  record: T;
  /** Cosine similarity in [-1, 1]. */
  similarity: number;
}

export interface DedupOptions {
  /** Cosine similarity at/above which two records are considered duplicates. Default 0.92. */
  threshold?: number;
  /**
   * When set, also treat records as duplicates if their normalized content is
   * identical, even when embeddings are missing. Default true.
   */
  matchExactContent?: boolean;
}

export interface DedupResult<T extends EmbeddedRecord> {
  /** Records kept after dedup (one representative per duplicate cluster). */
  kept: T[];
  /** Records removed as duplicates. */
  removed: T[];
  /** Cluster mapping: kept record index -> the records merged into it (incl. itself). */
  clusters: T[][];
}

const DEFAULT_THRESHOLD = 0.92;

// ─── Cosine Similarity ────────────────────────────────────────────────────────

/**
 * Cosine similarity between two equal-length vectors. Returns 0 for empty,
 * mismatched-length, or zero-magnitude inputs (never NaN).
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  const sim = dot / denom;
  // Guard against floating-point drift outside [-1, 1].
  if (sim > 1) return 1;
  if (sim < -1) return -1;
  return sim;
}

/** Cosine distance = 1 - cosine similarity. */
export function cosineDistance(a: readonly number[], b: readonly number[]): number {
  return 1 - cosineSimilarity(a, b);
}

// ─── Duplicate Detection ──────────────────────────────────────────────────────

function normalizeContent(content: string | undefined): string {
  if (!content) return "";
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Find the best matching existing record for a candidate embedding.
 * Returns null if nothing reaches the threshold.
 */
export function findBestMatch<T extends EmbeddedRecord>(
  candidateEmbedding: readonly number[],
  existing: readonly T[],
  threshold: number = DEFAULT_THRESHOLD,
): DuplicateMatch<T> | null {
  let best: DuplicateMatch<T> | null = null;

  for (const record of existing) {
    if (!record.embedding || record.embedding.length === 0) continue;
    const similarity = cosineSimilarity(candidateEmbedding, record.embedding);
    if (similarity >= threshold && (best === null || similarity > best.similarity)) {
      best = { record, similarity };
    }
  }

  return best;
}

/**
 * Returns true if the candidate embedding is a semantic duplicate of any
 * existing record (cosine similarity >= threshold).
 */
export function isDuplicate<T extends EmbeddedRecord>(
  candidateEmbedding: readonly number[],
  existing: readonly T[],
  threshold: number = DEFAULT_THRESHOLD,
): boolean {
  return findBestMatch(candidateEmbedding, existing, threshold) !== null;
}

/**
 * Full record-level duplicate check. Considers both embedding similarity and,
 * when enabled, exact normalized-content equality (useful when embeddings are
 * absent). Returns the matched record + similarity, or null.
 */
export function findDuplicateRecord<T extends EmbeddedRecord>(
  candidate: EmbeddedRecord,
  existing: readonly T[],
  options?: DedupOptions,
): DuplicateMatch<T> | null {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const matchExactContent = options?.matchExactContent ?? true;

  if (candidate.embedding && candidate.embedding.length > 0) {
    const match = findBestMatch(candidate.embedding, existing, threshold);
    if (match) return match;
  }

  if (matchExactContent) {
    const norm = normalizeContent(candidate.content);
    if (norm.length > 0) {
      for (const record of existing) {
        if (normalizeContent(record.content) === norm) {
          return { record, similarity: 1 };
        }
      }
    }
  }

  return null;
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * Merge two duplicate records into one. The "primary" is chosen by importance
 * (then recency); the other contributes tags and, if the primary lacks content,
 * its content. Embeddings are averaged so the survivor sits at the centroid of
 * the cluster, improving future matches.
 */
export function mergeRecords<T extends EmbeddedRecord>(a: T, b: T): T {
  const aScore = a.importance ?? 0;
  const bScore = b.importance ?? 0;
  let primary: T;
  let secondary: T;

  if (aScore !== bScore) {
    [primary, secondary] = aScore > bScore ? [a, b] : [b, a];
  } else {
    // Tie on importance: prefer the more recent record.
    [primary, secondary] = (a.createdAt ?? 0) >= (b.createdAt ?? 0) ? [a, b] : [b, a];
  }

  const mergedTags = Array.from(
    new Set([...(primary.tags ?? []), ...(secondary.tags ?? [])]),
  );

  const mergedEmbedding = averageEmbeddings(
    primary.embedding ?? undefined,
    secondary.embedding ?? undefined,
  );

  return {
    ...primary,
    content: primary.content && primary.content.length > 0 ? primary.content : secondary.content,
    tags: mergedTags,
    importance: Math.max(aScore, bScore),
    embedding: mergedEmbedding ?? primary.embedding ?? secondary.embedding ?? null,
  };
}

/** Element-wise average of two equal-length embeddings, or one if the other is missing. */
export function averageEmbeddings(
  a: number[] | undefined,
  b: number[] | undefined,
): number[] | undefined {
  if (a && b && a.length === b.length && a.length > 0) {
    const out = new Array<number>(a.length);
    for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
    return out;
  }
  if (a && a.length > 0) return a;
  if (b && b.length > 0) return b;
  return undefined;
}

/**
 * Deduplicate a list of records in a single pass. Each record is compared
 * against already-kept representatives; matches are merged into their
 * representative rather than dropped, preserving tags and centroid embeddings.
 */
export function dedupeRecords<T extends EmbeddedRecord>(
  records: readonly T[],
  options?: DedupOptions,
): DedupResult<T> {
  const kept: T[] = [];
  const clusters: T[][] = [];
  const removed: T[] = [];

  for (const record of records) {
    const match = findDuplicateRecord(record, kept, options);
    if (match) {
      const idx = kept.indexOf(match.record);
      removed.push(record);
      clusters[idx].push(record);
      // Update the representative with merged metadata/centroid.
      kept[idx] = mergeRecords(kept[idx], record);
    } else {
      kept.push(record);
      clusters.push([record]);
    }
  }

  if (removed.length > 0) {
    logger.debug({ input: records.length, kept: kept.length, removed: removed.length }, "Deduplicated memories");
  }

  return { kept, removed, clusters };
}
