import { describe, it, expect } from "vitest";
import {
  planPromptCache,
  buildCachedSystemBlocks,
  hasCacheBreakpoints,
  MAX_CACHE_BREAKPOINTS,
} from "../../agent/src/models/prompt-cache.js";
import type { ChatParams } from "../../agent/src/models/provider.js";

const params: ChatParams = {
  model: "claude-sonnet-4-20250514",
  systemPrompt: "You are Karna.",
  messages: [
    { role: "user", content: "1" },
    { role: "assistant", content: "2" },
    { role: "user", content: "3" },
  ],
  tools: [
    { name: "a", description: "", parameters: {} },
    { name: "b", description: "", parameters: {} },
  ],
};

describe("planPromptCache (#592)", () => {
  it("caches system and the last tool by default", () => {
    const plan = planPromptCache(params);
    expect(plan.systemCacheControl).toEqual({ type: "ephemeral", ttl: "5m" });
    expect(plan.toolsCacheIndex).toBe(1);
    expect(hasCacheBreakpoints(plan)).toBe(true);
  });

  it("honors the 1h ttl and disabling flags", () => {
    const plan = planPromptCache(params, { ttl: "1h", cacheTools: false });
    expect(plan.systemCacheControl?.ttl).toBe("1h");
    expect(plan.toolsCacheIndex).toBeNull();
  });

  it("adds a conversation-prefix breakpoint when requested", () => {
    const plan = planPromptCache(params, { cachePrefixMessages: 1 });
    // last 1 message excluded -> boundary at index 1
    expect(plan.messageCacheIndices).toEqual([1]);
  });

  it("never exceeds the max breakpoint budget", () => {
    const plan = planPromptCache(params, { cachePrefixMessages: 1 });
    const count =
      (plan.systemCacheControl ? 1 : 0) +
      (plan.toolsCacheIndex !== null ? 1 : 0) +
      plan.messageCacheIndices.length;
    expect(count).toBeLessThanOrEqual(MAX_CACHE_BREAKPOINTS);
  });

  it("is pure (does not mutate params)", () => {
    const snapshot = JSON.stringify(params);
    planPromptCache(params);
    expect(JSON.stringify(params)).toBe(snapshot);
  });

  it("builds cached system blocks", () => {
    const blocks = buildCachedSystemBlocks("hi", { type: "ephemeral", ttl: "5m" });
    expect(blocks).toEqual([{ type: "text", text: "hi", cache_control: { type: "ephemeral", ttl: "5m" } }]);
    expect(buildCachedSystemBlocks(undefined, null)).toBeUndefined();
  });
});
