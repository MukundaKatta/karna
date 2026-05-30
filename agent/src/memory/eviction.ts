// ─── Memory TTL & Eviction ─────────────────────────────────────────────────
// Pure eviction policies operating over a list of memory records.
// Each policy returns which entries should be evicted, leaving the actual
// deletion to the caller. Additive & non-breaking: nothing runs unless invoked.

import type { MemoryEntry, MemoryPriority } from "@karna/shared/types/memory.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EvictionPolicy = "lru" | "importance" | "ttl";

export interface EvictionOptions {
  /** Which policy to apply. Default: "lru". */
  policy?: EvictionPolicy;
  /**
   * Maximum number of entries to retain (capacity). When the record count
   * exceeds this, the surplus is selected for eviction (lru / importance).
   * Ignored for the pure "ttl" policy (which evicts purely by expiry).
   */
  maxEntries?: number;
  /** Reference timestamp (ms). Default: Date.now(). Injectable for tests. */
  now?: number;
  /**
   * For "ttl": entries older than this many ms (by createdAt) are evicted,
   * in addition to those with an elapsed `expiresAt`. Optional.
   */
  maxAgeMs?: number;
  /**
   * Priorities that are never evicted regardless of policy.
   * Default: ["critical"].
   */
  protectedPriorities?: MemoryPriority[];
}

export interface TierEvictionConfig {
  working?: EvictionOptions;
  shortTerm?: EvictionOptions;
  longTerm?: EvictionOptions;
}

const DEFAULT_PROTECTED: MemoryPriority[] = ["critical"];

// ─── Helpers ────────────────────────────────────────────────────────────────

function isProtected(entry: MemoryEntry, protectedPriorities: MemoryPriority[]): boolean {
  return protectedPriorities.includes(entry.priority);
}

/** Numeric weight per priority for importance-weighted eviction. */
function priorityWeight(priority: MemoryPriority): number {
  switch (priority) {
    case "critical":
      return 3;
    case "high":
      return 2;
    case "normal":
      return 1;
    case "low":
    default:
      return 0;
  }
}

/**
 * Importance heuristic used by the "importance" policy. Higher = keep.
 * Combines priority weight, access count (log-scaled) and decay factor.
 */
function importanceValue(entry: MemoryEntry): number {
  const access = Math.log1p(Math.max(0, entry.accessCount));
  const decay = Number.isFinite(entry.decayFactor) ? entry.decayFactor : 1;
  return priorityWeight(entry.priority) * 2 + access + decay;
}

// ─── TTL Eviction ─────────────────────────────────────────────────────────

/**
 * Select entries whose `expiresAt` has elapsed, or whose age exceeds
 * `maxAgeMs` when provided. Protected priorities are never evicted.
 */
export function selectExpired(
  records: MemoryEntry[],
  options?: EvictionOptions,
): MemoryEntry[] {
  const now = options?.now ?? Date.now();
  const maxAgeMs = options?.maxAgeMs;
  const protectedPriorities = options?.protectedPriorities ?? DEFAULT_PROTECTED;

  return records.filter((entry) => {
    if (isProtected(entry, protectedPriorities)) return false;
    const expired = entry.expiresAt !== undefined && entry.expiresAt <= now;
    const tooOld = maxAgeMs !== undefined && now - entry.createdAt > maxAgeMs;
    return expired || tooOld;
  });
}

// ─── LRU Eviction ─────────────────────────────────────────────────────────

/**
 * Select the least-recently-used surplus beyond `maxEntries`.
 * Recency is measured by `accessedAt` (oldest evicted first).
 */
export function selectLru(
  records: MemoryEntry[],
  options?: EvictionOptions,
): MemoryEntry[] {
  const maxEntries = options?.maxEntries;
  const protectedPriorities = options?.protectedPriorities ?? DEFAULT_PROTECTED;
  if (maxEntries === undefined || records.length <= maxEntries) return [];

  const evictable = records.filter((e) => !isProtected(e, protectedPriorities));
  const protectedCount = records.length - evictable.length;
  const surplus = records.length - maxEntries;
  // Don't try to evict protected entries to reach capacity.
  const toEvictCount = Math.max(0, Math.min(surplus, evictable.length));
  if (toEvictCount === 0) return [];

  // Oldest accessedAt first.
  const ordered = [...evictable].sort((a, b) => a.accessedAt - b.accessedAt);
  void protectedCount;
  return ordered.slice(0, toEvictCount);
}

// ─── Importance-Weighted Eviction ──────────────────────────────────────────

/**
 * Select the lowest-importance surplus beyond `maxEntries`.
 * Lowest importance evicted first; ties broken by oldest `accessedAt`.
 */
export function selectByImportance(
  records: MemoryEntry[],
  options?: EvictionOptions,
): MemoryEntry[] {
  const maxEntries = options?.maxEntries;
  const protectedPriorities = options?.protectedPriorities ?? DEFAULT_PROTECTED;
  if (maxEntries === undefined || records.length <= maxEntries) return [];

  const evictable = records.filter((e) => !isProtected(e, protectedPriorities));
  const surplus = records.length - maxEntries;
  const toEvictCount = Math.max(0, Math.min(surplus, evictable.length));
  if (toEvictCount === 0) return [];

  const ordered = [...evictable].sort((a, b) => {
    const diff = importanceValue(a) - importanceValue(b);
    if (diff !== 0) return diff; // lowest importance first
    return a.accessedAt - b.accessedAt; // then oldest
  });
  return ordered.slice(0, toEvictCount);
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * Apply the configured eviction policy to a list of records, returning the
 * entries that should be evicted. Pure: does not mutate input.
 *
 * For "lru" / "importance", expired entries (by `expiresAt`) are always
 * included so that capacity-based policies still honor explicit TTLs.
 */
export function selectForEviction(
  records: MemoryEntry[],
  options?: EvictionOptions,
): MemoryEntry[] {
  const policy = options?.policy ?? "lru";

  if (policy === "ttl") {
    return selectExpired(records, options);
  }

  // Capacity-based policies also honor explicit TTL expiry.
  const expired = selectExpired(records, { ...options, maxAgeMs: undefined });
  const expiredIds = new Set(expired.map((e) => e.id));
  const live = records.filter((e) => !expiredIds.has(e.id));

  const capacityEvicted =
    policy === "importance"
      ? selectByImportance(live, options)
      : selectLru(live, options);

  // De-dupe in case of overlap.
  const result: MemoryEntry[] = [...expired];
  const seen = new Set(expiredIds);
  for (const e of capacityEvicted) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      result.push(e);
    }
  }
  return result;
}

/**
 * Convenience: return the records that survive eviction.
 */
export function retainAfterEviction(
  records: MemoryEntry[],
  options?: EvictionOptions,
): MemoryEntry[] {
  const evicted = new Set(selectForEviction(records, options).map((e) => e.id));
  return records.filter((e) => !evicted.has(e.id));
}
