import { describe, it, expect } from "vitest";
import { ModelFailover } from "../../agent/src/models/failover.js";
import { AgentModelError } from "../../agent/src/models/anthropic.js";
import type { ModelProvider, ChatParams, StreamEvent } from "../../agent/src/models/provider.js";

// ─── Mock Providers ─────────────────────────────────────────────────────────

function createMockProvider(name: string, shouldFail: boolean, errorCode?: string): ModelProvider {
  return {
    name,
    async *chat(_params: ChatParams): AsyncGenerator<StreamEvent> {
      if (shouldFail) {
        throw new AgentModelError(
          (errorCode as "PROVIDER_ERROR") ?? "PROVIDER_ERROR",
          `${name} failed`,
        );
      }
      yield { type: "text", text: `Response from ${name}` };
      yield { type: "usage", inputTokens: 10, outputTokens: 5 };
      yield { type: "done" };
    },
    countTokens(text: string): number {
      return Math.ceil(text.length / 4);
    },
  };
}

describe("ModelFailover", () => {
  it("uses primary model when it succeeds", async () => {
    const failover = new ModelFailover({
      primary: { provider: createMockProvider("primary", false), model: "model-a" },
      fallbacks: [{ provider: createMockProvider("fallback", false), model: "model-b" }],
    });

    const events: StreamEvent[] = [];
    for await (const event of failover.chat({ messages: [], model: "model-a" })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "text" && e.text.includes("primary"))).toBe(true);
  });

  it("falls back when primary fails", async () => {
    const failover = new ModelFailover({
      primary: { provider: createMockProvider("primary", true), model: "model-a" },
      fallbacks: [{ provider: createMockProvider("fallback", false), model: "model-b" }],
    });

    const events: StreamEvent[] = [];
    for await (const event of failover.chat({ messages: [], model: "model-a" })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "text" && e.text.includes("fallback"))).toBe(true);
  });

  it("tries all models in chain before throwing", async () => {
    const failover = new ModelFailover({
      primary: { provider: createMockProvider("p1", true), model: "m1" },
      fallbacks: [
        { provider: createMockProvider("p2", true), model: "m2" },
        { provider: createMockProvider("p3", true), model: "m3" },
      ],
    });

    await expect(async () => {
      for await (const _ of failover.chat({ messages: [] })) { /* consume */ }
    }).rejects.toThrow("All models in failover chain exhausted");
  });

  it("skips providers with AUTH_ERROR immediately", async () => {
    const failover = new ModelFailover({
      primary: { provider: createMockProvider("auth-fail", true, "AUTH_ERROR"), model: "m1" },
      fallbacks: [{ provider: createMockProvider("works", false), model: "m2" }],
    });

    const events: StreamEvent[] = [];
    for await (const event of failover.chat({ messages: [] })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "text" && e.text.includes("works"))).toBe(true);
  });

  it("skips PROVIDER_UNAVAILABLE immediately", async () => {
    const failover = new ModelFailover({
      primary: { provider: createMockProvider("unavail", true, "PROVIDER_UNAVAILABLE"), model: "m1" },
      fallbacks: [{ provider: createMockProvider("backup", false), model: "m2" }],
    });

    const events: StreamEvent[] = [];
    for await (const event of failover.chat({ messages: [] })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "text" && e.text.includes("backup"))).toBe(true);
  });

  it("reports chain info", () => {
    const failover = new ModelFailover({
      primary: { provider: createMockProvider("p1", false), model: "m1" },
      fallbacks: [{ provider: createMockProvider("p2", false), model: "m2" }],
    });

    const info = failover.getChainInfo();
    expect(info.primaryModel).toBe("p1/m1");
    expect(info.models).toEqual(["p1/m1", "p2/m2"]);
  });
});
