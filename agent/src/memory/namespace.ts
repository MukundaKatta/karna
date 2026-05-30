// ─── Per-User / Per-Channel Namespaces ─────────────────────────────────────
// Additive helpers for partitioning memories by user and/or channel.
// Namespacing is entirely optional: existing memories without namespace data
// continue to work unchanged. A namespace is encoded as a stable string key
// and can also be matched against MemoryEntry fields/tags.

import type { MemoryEntry } from "@karna/shared/types/memory.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Namespace {
  userId?: string;
  channelId?: string;
}

/** Guidance for how a namespace should be applied across the memory tiers. */
export interface NamespaceGuidance {
  /** Persist the namespace key as a tag on long-term entries. Default: true. */
  tagLongTerm?: boolean;
  /** Restrict retrieval to the active namespace. Default: false (additive). */
  isolateRetrieval?: boolean;
  /** Fall back to namespace-less ("global") memories when isolating. Default: true. */
  includeGlobal?: boolean;
}

export const NAMESPACE_TAG_PREFIX = "ns:";
const SEP = "::";
const WILDCARD = "*";

// ─── Construction ─────────────────────────────────────────────────────────

function sanitizeSegment(value: string | undefined): string {
  if (!value) return WILDCARD;
  // Keep keys filesystem/tag safe and collision-resistant.
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned : WILDCARD;
}

/**
 * Build a stable namespace key from a user and/or channel id.
 * Missing segments become "*" (wildcard). Examples:
 *   makeNamespace("u1", "c1") => "u:u1::c:c1"
 *   makeNamespace("u1")        => "u:u1::c:*"
 *   makeNamespace()            => "u:*::c:*"  (the global namespace)
 */
export function makeNamespace(userId?: string, channelId?: string): string {
  return `u:${sanitizeSegment(userId)}${SEP}c:${sanitizeSegment(channelId)}`;
}

/** The global (un-namespaced) key. */
export const GLOBAL_NAMESPACE = makeNamespace();

/** True when the key has no user and no channel component. */
export function isGlobalNamespace(key: string): boolean {
  return key === GLOBAL_NAMESPACE;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Parse a namespace key back into its parts. Wildcards become `undefined`.
 * Returns null when the input is not a valid namespace key.
 */
export function parseNamespace(key: string): Namespace | null {
  const parts = key.split(SEP);
  if (parts.length !== 2) return null;
  const [userPart, channelPart] = parts;
  if (!userPart.startsWith("u:") || !channelPart.startsWith("c:")) return null;

  const userId = userPart.slice(2);
  const channelId = channelPart.slice(2);

  return {
    userId: userId === WILDCARD ? undefined : userId,
    channelId: channelId === WILDCARD ? undefined : channelId,
  };
}

/** The tag form used to stamp a namespace onto a MemoryEntry. */
export function namespaceTag(userId?: string, channelId?: string): string {
  return `${NAMESPACE_TAG_PREFIX}${makeNamespace(userId, channelId)}`;
}

/** Extract the namespace key from a memory entry's tags, if stamped. */
export function namespaceFromEntry(entry: MemoryEntry): string | null {
  const tag = (entry.tags ?? []).find((t) => t.startsWith(NAMESPACE_TAG_PREFIX));
  return tag ? tag.slice(NAMESPACE_TAG_PREFIX.length) : null;
}

// ─── Matching ─────────────────────────────────────────────────────────────

/**
 * Whether an entry belongs to the given namespace key.
 * Matching prefers explicit `userId` fields on the entry, then falls back to a
 * stamped `ns:` tag. A wildcard segment in the query matches anything.
 */
export function entryMatchesNamespace(entry: MemoryEntry, key: string): boolean {
  const target = parseNamespace(key);
  if (!target) return false;

  // Resolve the entry's effective namespace: prefer structured fields, then tag.
  let entryNs: Namespace | null = null;
  if (entry.userId !== undefined) {
    entryNs = { userId: entry.userId };
  }
  const stamped = namespaceFromEntry(entry);
  if (stamped) {
    const parsed = parseNamespace(stamped);
    if (parsed) {
      entryNs = {
        userId: entryNs?.userId ?? parsed.userId,
        channelId: parsed.channelId,
      };
    }
  }

  // No namespace info on the entry => only matches the global query.
  if (!entryNs) return target.userId === undefined && target.channelId === undefined;

  const userOk = target.userId === undefined || target.userId === entryNs.userId;
  const channelOk =
    target.channelId === undefined || target.channelId === entryNs.channelId;
  return userOk && channelOk;
}

// ─── Filtering ──────────────────────────────────────────────────────────────

export interface FilterByNamespaceOptions {
  /** Also include global (un-namespaced) entries. Default: true. */
  includeGlobal?: boolean;
}

/**
 * Filter records down to those belonging to a namespace key.
 * Additive by default: global/un-namespaced entries are kept unless
 * `includeGlobal` is false. A wildcard query (the global key) returns all
 * records unchanged.
 */
export function filterByNamespace(
  records: MemoryEntry[],
  key: string,
  options?: FilterByNamespaceOptions,
): MemoryEntry[] {
  if (isGlobalNamespace(key)) return [...records];
  const includeGlobal = options?.includeGlobal ?? true;

  return records.filter((entry) => {
    if (entryMatchesNamespace(entry, key)) return true;
    if (includeGlobal && !namespaceFromEntry(entry) && entry.userId === undefined) {
      return true;
    }
    return false;
  });
}
