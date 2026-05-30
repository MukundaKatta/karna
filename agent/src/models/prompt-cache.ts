// ─── Anthropic Prompt Caching (Issue #592) ───────────────────────────────────
//
// Pure helpers that decide where to place Anthropic `cache_control` breakpoints
// for the *stable prefix* of a request (system prompt + tool definitions, and
// optionally a conversation prefix). Caching the stable prefix yields a large
// cache-read discount (cache reads are ~0.1x input price) at the cost of a
// one-time cache write (~1.25x), so it pays off across multi-turn / multi-tool
// loops. This module is provider-agnostic and side-effect-free; the Anthropic
// provider can consume the plan to annotate its request. Opt-in only.

import type { ChatParams } from "./provider.js";

export type CacheTtl = "5m" | "1h";

export interface CacheControl {
  type: "ephemeral";
  ttl?: CacheTtl;
}

export interface PromptCacheOptions {
  /** Cache the system prompt block. Default true. */
  cacheSystem?: boolean;
  /** Cache the (last) tool definition, which caches the whole tools block. Default true. */
  cacheTools?: boolean;
  /** Cache the conversation prefix up to N messages before the end. Default 0 (off). */
  cachePrefixMessages?: number;
  /** Cache TTL. Default "5m". */
  ttl?: CacheTtl;
}

export interface PromptCachePlan {
  /** cache_control to attach to the system block, or null. */
  systemCacheControl: CacheControl | null;
  /** Index of the tool to attach cache_control to (the last tool), or null. */
  toolsCacheIndex: number | null;
  /** Message indices that should carry a cache breakpoint. */
  messageCacheIndices: number[];
}

/** Anthropic permits at most 4 cache breakpoints per request. */
export const MAX_CACHE_BREAKPOINTS = 4;

/**
 * Compute where to place cache breakpoints for a request's stable prefix.
 * Pure: never mutates `params`.
 */
export function planPromptCache(
  params: ChatParams,
  options: PromptCacheOptions = {},
): PromptCachePlan {
  const cacheSystem = options.cacheSystem ?? true;
  const cacheTools = options.cacheTools ?? true;
  const prefix = options.cachePrefixMessages ?? 0;
  const ttl = options.ttl ?? "5m";
  const control: CacheControl = { type: "ephemeral", ttl };

  let budget = MAX_CACHE_BREAKPOINTS;

  const systemCacheControl = cacheSystem && params.systemPrompt && budget > 0 ? control : null;
  if (systemCacheControl) budget -= 1;

  const toolsCacheIndex =
    cacheTools && params.tools && params.tools.length > 0 && budget > 0
      ? params.tools.length - 1
      : null;
  if (toolsCacheIndex !== null) budget -= 1;

  const messageCacheIndices: number[] = [];
  if (prefix > 0 && params.messages.length > 0) {
    const boundary = Math.max(0, params.messages.length - prefix) - 1;
    if (boundary >= 0 && budget > 0) {
      messageCacheIndices.push(boundary);
      budget -= 1;
    }
  }

  return { systemCacheControl, toolsCacheIndex, messageCacheIndices };
}

/**
 * Build Anthropic-style system blocks from a plain system prompt, attaching
 * `cache_control` when the plan calls for it. Returns undefined when there is
 * no system prompt.
 */
export function buildCachedSystemBlocks(
  systemPrompt: string | undefined,
  control: CacheControl | null,
): Array<{ type: "text"; text: string; cache_control?: CacheControl }> | undefined {
  if (!systemPrompt) return undefined;
  const block: { type: "text"; text: string; cache_control?: CacheControl } = {
    type: "text",
    text: systemPrompt,
  };
  if (control) block.cache_control = control;
  return [block];
}

/** Whether a plan places any cache breakpoints at all. */
export function hasCacheBreakpoints(plan: PromptCachePlan): boolean {
  return (
    plan.systemCacheControl !== null ||
    plan.toolsCacheIndex !== null ||
    plan.messageCacheIndices.length > 0
  );
}
