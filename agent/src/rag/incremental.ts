// ─── Incremental Re-indexing ──────────────────────────────────────────────────
// Issue #602. Content-hash based change detection: given a previous index
// snapshot and a freshly-ingested chunk set, compute which chunks were added,
// updated, or deleted so a vector store can be upserted/pruned without a full
// re-embed. Pure & dependency-free.
//
// Works with the hashed chunks from ingestion.ts (or any chunk carrying a
// `contentHash`; for plain TextChunks the hash is derived from `content`).

import type { TextChunk } from "./chunker.js";
import { contentHash, type IngestedChunk } from "./ingestion.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal shape needed for change detection. */
export interface HashedChunk {
  id: string;
  contentHash: string;
}

/** A stored record describing a previously-indexed chunk. */
export interface IndexRecord {
  id: string;
  contentHash: string;
}

export interface ChangeSet<T extends HashedChunk = IngestedChunk> {
  /** Chunks present now but not previously indexed. */
  added: T[];
  /** Chunks whose id existed before but whose content hash changed. */
  updated: T[];
  /** Ids that were previously indexed but are absent now. */
  deleted: string[];
  /** Ids present and unchanged (no re-embed needed). */
  unchanged: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Ensure a chunk has a contentHash, deriving it from `content` if missing. */
export function ensureHash<T extends TextChunk>(chunk: T): T & HashedChunk {
  const existing = (chunk as Partial<HashedChunk>).contentHash;
  return { ...chunk, contentHash: existing ?? contentHash(chunk.content) };
}

// ─── Diff ─────────────────────────────────────────────────────────────────────

/**
 * Diff a new set of chunks against the previous index snapshot. Matching is by
 * chunk `id`; a differing `contentHash` marks an update.
 */
export function diffChunks<T extends HashedChunk>(
  previous: HashedChunk[],
  next: T[],
): ChangeSet<T> {
  const prevById = new Map<string, string>();
  for (const p of previous) prevById.set(p.id, p.contentHash);

  const added: T[] = [];
  const updated: T[] = [];
  const unchanged: string[] = [];
  const seen = new Set<string>();

  for (const chunk of next) {
    seen.add(chunk.id);
    const prevHash = prevById.get(chunk.id);
    if (prevHash === undefined) added.push(chunk);
    else if (prevHash !== chunk.contentHash) updated.push(chunk);
    else unchanged.push(chunk.id);
  }

  const deleted: string[] = [];
  for (const p of previous) if (!seen.has(p.id)) deleted.push(p.id);

  return { added, updated, deleted, unchanged };
}

/**
 * Convenience for plain TextChunks that may not carry a hash: computes hashes
 * (from `contentHash` field or `content`) before diffing.
 */
export function diffDocuments(
  previous: HashedChunk[],
  nextChunks: TextChunk[],
): ChangeSet<TextChunk & HashedChunk> {
  return diffChunks(previous, nextChunks.map(ensureHash));
}

// ─── Reporting helpers ────────────────────────────────────────────────────────

/** True if a change set contains any work to apply. */
export function hasChanges(change: ChangeSet<HashedChunk>): boolean {
  return (
    change.added.length > 0 ||
    change.updated.length > 0 ||
    change.deleted.length > 0
  );
}

/** The chunks needing (re-)embedding: added + updated. */
export function chunksToUpsert<T extends HashedChunk>(change: ChangeSet<T>): T[] {
  return [...change.added, ...change.updated];
}

/** Project a chunk list into IndexRecords for persistence as a snapshot. */
export function toIndexRecords(chunks: HashedChunk[]): IndexRecord[] {
  return chunks.map((c) => ({ id: c.id, contentHash: c.contentHash }));
}

export default diffChunks;
