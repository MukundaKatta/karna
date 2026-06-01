import { describe, it, expect } from "vitest";
import { AnthropicProvider } from "../../agent/src/models/anthropic.js";
import type { ChatParams } from "../../agent/src/models/provider.js";

interface ToolWithCache {
  name: string;
  cache_control?: { type: string; ttl: string };
}
interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: string; ttl: string };
}

// Exercise the private applyPromptCache helper (mirrors the pattern in
// model-tool-messages.test.ts) — no live SDK needed.
function applyCache(
  provider: AnthropicProvider,
  params: ChatParams,
  tools: ToolWithCache[] | undefined,
): { system: unknown } {
  return (
    provider as unknown as {
      applyPromptCache(p: ChatParams, t: ToolWithCache[] | undefined): { system: unknown };
    }
  ).applyPromptCache(params, tools);
}

const provider = new AnthropicProvider("test-key");

const base: ChatParams = {
  systemPrompt: "You are Karna.",
  messages: [{ role: "user", content: "hi" }],
};

describe("Anthropic prompt caching wiring (#592)", () => {
  it("is a pass-through when no cache directive is set", () => {
    const tools: ToolWithCache[] = [{ name: "a" }, { name: "b" }];
    const { system } = applyCache(provider, base, tools);
    expect(system).toBe("You are Karna.");
    expect(tools[1].cache_control).toBeUndefined();
  });

  it("annotates system + last tool when cache is requested", () => {
    const tools: ToolWithCache[] = [{ name: "a" }, { name: "b" }];
    const { system } = applyCache(provider, { ...base, cache: { ttl: "1h" } }, tools);
    const block = (system as SystemBlock[])[0];
    expect(block.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    // Only the last tool is marked (caches the whole tools prefix).
    expect(tools[1].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(tools[0].cache_control).toBeUndefined();
  });

  it("respects system:false / tools:false toggles", () => {
    const tools: ToolWithCache[] = [{ name: "a" }];
    const { system } = applyCache(
      provider,
      { ...base, cache: { system: false, tools: false } },
      tools,
    );
    expect(system).toBe("You are Karna."); // not annotated
    expect(tools[0].cache_control).toBeUndefined();
  });

  it("defaults ttl to 5m", () => {
    const tools: ToolWithCache[] = [{ name: "a" }];
    applyCache(provider, { ...base, cache: {} }, tools);
    expect(tools[0].cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
  });
});
