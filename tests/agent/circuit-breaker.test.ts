import { describe, it, expect } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerProvider,
  CircuitOpenError,
} from "../../agent/src/models/circuit-breaker.js";
import type { ModelProvider, ChatParams, StreamEvent } from "../../agent/src/models/provider.js";

describe("CircuitBreaker (#594)", () => {
  it("opens after the failure threshold and blocks requests", () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, now: () => now });
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.canRequest()).toBe(false);
  });

  it("half-opens after cooldown and closes on success", () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => now });
    cb.recordFailure();
    expect(cb.canRequest()).toBe(false);
    now = 1000;
    expect(cb.canRequest()).toBe(true);
    expect(cb.getState()).toBe("half-open");
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
  });

  it("re-opens if the half-open probe fails", () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => now });
    cb.recordFailure();
    now = 1000;
    cb.canRequest(); // -> half-open
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });
});

class FakeProvider implements ModelProvider {
  name = "fake";
  constructor(private readonly mode: "ok" | "throw") {}
  async *chat(_params: ChatParams): AsyncGenerator<StreamEvent> {
    if (this.mode === "throw") throw new Error("boom");
    yield { type: "text", text: "ok" };
    yield { type: "usage", inputTokens: 1, outputTokens: 1 };
    yield { type: "done" };
  }
}

async function drain(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("CircuitBreakerProvider (#594)", () => {
  it("passes through and records success", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    const p = new CircuitBreakerProvider(new FakeProvider("ok"), cb);
    const events = await drain(p.chat({ model: "m", messages: [] }));
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(cb.getState()).toBe("closed");
  });

  it("records failure on a thrown error and then short-circuits", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 10_000, now: () => 0 });
    const p = new CircuitBreakerProvider(new FakeProvider("throw"), cb);
    await expect(drain(p.chat({ model: "m", messages: [] }))).rejects.toThrow("boom");
    expect(cb.getState()).toBe("open");
    await expect(drain(p.chat({ model: "m", messages: [] }))).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
