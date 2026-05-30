// ─── Episodic vs Semantic Memory ────────────────────────────────────────────
// Issue #540 — Distinguish episodic (time/event-bound, "what happened") from
// semantic (timeless facts/preferences, "what is true") memories.
//
// The distinction is additive: it is encoded as a `mem:<type>` tag on existing
// MemoryEntry records so no schema change is required and un-tagged memories
// keep working. This module provides:
//   - classification (tag <-> MemoryType helpers)
//   - separate retrieve helpers that filter by type
//   - a consolidation pass that distills a cluster of episodic memories into a
//     single semantic memory input.
//
// Pure & non-breaking: no persistence is performed here; consolidation returns
// SaveMemoryInput objects for the caller to persist.

import type { MemoryEntry } from "@karna/shared/types/memory.js";
import type { SaveMemoryInput } from "./store.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type MemoryType = "episodic" | "semantic";

export const MEMORY_TYPE_TAG_PREFIX = "mem:";

/** Tag form used to stamp a memory type onto an entry. */
export function memoryTypeTag(type: MemoryType): string {
  return `${MEMORY_TYPE_TAG_PREFIX}${type}`;
}

const EPISODIC_TAG = memoryTypeTag("episodic");
const SEMANTIC_TAG = memoryTypeTag("semantic");

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * Read the explicit memory type from an entry's tags, if stamped.
 * Returns null when the entry carries no `mem:` tag.
 */
export function explicitMemoryType(entry: Pick<MemoryEntry, "tags">): MemoryType | null {
  const tags = entry.tags ?? [];
  if (tags.includes(SEMANTIC_TAG)) return "semantic";
  if (tags.includes(EPISODIC_TAG)) return "episodic";
  return null;
}

/**
 * Infer a memory type for an un-tagged entry using lightweight heuristics:
 * conversation/tool_result with a session are treated as episodic (they record
 * "what happened"); user_feedback/system/skill facts default to semantic.
 * This is only a fallback — an explicit `mem:` tag always wins.
 */
export function inferMemoryType(entry: Pick<MemoryEntry, "tags" | "source" | "sessionId">): MemoryType {
  const explicit = explicitMemoryType(entry);
  if (explicit) return explicit;

  switch (entry.source) {
    case "conversation":
    case "tool_result":
    case "external":
      // Session-scoped events read as episodic; otherwise lean semantic.
      return entry.sessionId ? "episodic" : "semantic";
    case "user_feedback":
    case "system":
    case "skill":
    case "document":
    default:
      return "semantic";
  }
}

/** Stamp a memory type tag onto a tag list (idempotent, removes the other type). */
export function withMemoryTypeTag(tags: string[] | undefined, type: MemoryType): string[] {
  const base = (tags ?? []).filter((t) => t !== EPISODIC_TAG && t !== SEMANTIC_TAG);
  base.push(memoryTypeTag(type));
  return Array.from(new Set(base));
}

// ─── Retrieve Helpers ─────────────────────────────────────────────────────

export interface TypeFilterOptions {
  /**
   * When true, entries without an explicit `mem:` tag are classified via
   * {@link inferMemoryType}; when false they are excluded. Default: true.
   */
  inferUntagged?: boolean;
}

/** Filter records down to a given memory type. Pure; does not mutate input. */
export function filterByMemoryType(
  records: MemoryEntry[],
  type: MemoryType,
  options?: TypeFilterOptions,
): MemoryEntry[] {
  const inferUntagged = options?.inferUntagged ?? true;
  return records.filter((entry) => {
    const explicit = explicitMemoryType(entry);
    if (explicit) return explicit === type;
    if (!inferUntagged) return false;
    return inferMemoryType(entry) === type;
  });
}

/** Convenience: episodic-only view. */
export function retrieveEpisodic(records: MemoryEntry[], options?: TypeFilterOptions): MemoryEntry[] {
  return filterByMemoryType(records, "episodic", options);
}

/** Convenience: semantic-only view. */
export function retrieveSemantic(records: MemoryEntry[], options?: TypeFilterOptions): MemoryEntry[] {
  return filterByMemoryType(records, "semantic", options);
}

// ─── Consolidation: episodic -> semantic ──────────────────────────────────

export interface EpisodicConsolidationOptions {
  /** Minimum episodic memories required to emit a semantic distillation. Default: 2. */
  minCluster?: number;
  /**
   * Distill a cluster of episodic memories into a single semantic statement.
   * Injectable (LLM-backed) for richer summaries. Default: a deterministic
   * concatenation of summaries/content.
   */
  distill?: (cluster: MemoryEntry[]) => string | Promise<string>;
  /** Group key for a cluster. Default: `${category}`. */
  groupKey?: (entry: MemoryEntry) => string;
}

export interface ConsolidationPlan {
  /** New semantic memory inputs to persist. */
  semantic: SaveMemoryInput[];
  /** Ids of episodic source memories that were distilled (for optional pruning). */
  sourceIds: string[];
}

function defaultDistill(cluster: MemoryEntry[]): string {
  const parts = cluster
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m) => (m.summary && m.summary.length > 0 ? m.summary : m.content));
  return parts.join("; ").slice(0, 1000);
}

/**
 * Build a consolidation plan that distills clusters of episodic memories into
 * semantic memories. Does not persist anything; the caller persists the
 * returned `semantic` inputs (and may delete `sourceIds`).
 *
 * Episodic memories are grouped (by category by default); each group with at
 * least `minCluster` members yields one semantic SaveMemoryInput tagged
 * `mem:semantic` + `consolidated:episodic`.
 */
export async function consolidateEpisodicToSemantic(
  agentId: string,
  records: MemoryEntry[],
  options?: EpisodicConsolidationOptions,
): Promise<ConsolidationPlan> {
  const minCluster = Math.max(1, options?.minCluster ?? 2);
  const distill = options?.distill ?? defaultDistill;
  const groupKey = options?.groupKey ?? ((e: MemoryEntry) => e.category ?? "general");

  const episodic = retrieveEpisodic(records);
  const groups = new Map<string, MemoryEntry[]>();
  for (const entry of episodic) {
    const key = groupKey(entry);
    const arr = groups.get(key) ?? [];
    arr.push(entry);
    groups.set(key, arr);
  }

  const semantic: SaveMemoryInput[] = [];
  const sourceIds: string[] = [];

  for (const [key, cluster] of groups) {
    if (cluster.length < minCluster) continue;

    const content = await distill(cluster);
    if (!content || content.trim().length === 0) continue;

    const tags = withMemoryTypeTag(
      Array.from(new Set(cluster.flatMap((m) => m.tags ?? []))),
      "semantic",
    );
    tags.push("consolidated:episodic");

    const ordered = cluster.slice().sort((a, b) => a.createdAt - b.createdAt);

    semantic.push({
      agentId,
      content,
      summary: content.slice(0, 500),
      source: "system",
      priority: "normal",
      category: key,
      tags: Array.from(new Set(tags)),
      sessionId: ordered[0]?.sessionId,
      userId: ordered[0]?.userId,
    });
    for (const m of cluster) sourceIds.push(m.id);
  }

  return { semantic, sourceIds };
}
