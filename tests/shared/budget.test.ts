import { describe, it, expect } from "vitest";
import { TokenBudget } from "../../packages/shared/src/utils/budget.js";

// A model present in the shared pricing table (utils/cost.ts).
const MODEL = "gpt-4o-mini";

describe("TokenBudget (#596)", () => {
  it("tracks tokens and reports remaining headroom", () => {
    const b = new TokenBudget({ maxTotalTokens: 100 });
    const snap = b.consume({ inputTokens: 10, outputTokens: 5 }, MODEL);
    expect(snap.totalTokens).toBe(15);
    expect(b.reason()).toBeNull();
    expect(b.isExceeded()).toBe(false);
    expect(b.remaining().totalTokens).toBe(85);
  });

  it("flags the total-token limit as the stop reason", () => {
    const b = new TokenBudget({ maxTotalTokens: 20 });
    b.consume({ inputTokens: 15, outputTokens: 10 }, MODEL);
    expect(b.isExceeded()).toBe(true);
    expect(b.reason()).toBe("max-total-tokens");
  });

  it("flags input and output limits independently", () => {
    const bin = new TokenBudget({ maxInputTokens: 10 });
    bin.consume({ inputTokens: 10, outputTokens: 0 }, MODEL);
    expect(bin.reason()).toBe("max-input-tokens");

    const bout = new TokenBudget({ maxOutputTokens: 5 });
    bout.consume({ inputTokens: 0, outputTokens: 6 }, MODEL);
    expect(bout.reason()).toBe("max-output-tokens");
  });

  it("accumulates cost and flags the cost limit", () => {
    const b = new TokenBudget({ maxCostUsd: 0.0000001 });
    b.consume({ inputTokens: 1000, outputTokens: 1000 }, MODEL);
    expect(b.snapshot().costUsd).toBeGreaterThan(0);
    expect(b.reason()).toBe("max-cost");
  });

  it("treats omitted limits as unbounded", () => {
    const b = new TokenBudget({});
    b.consume({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, MODEL);
    expect(b.isExceeded()).toBe(false);
    expect(b.reason()).toBeNull();
    expect(b.remaining().totalTokens).toBe(Infinity);
    expect(b.remaining().costUsd).toBe(Infinity);
  });

  it("accumulates across multiple consume calls", () => {
    const b = new TokenBudget({});
    b.consume({ inputTokens: 10, outputTokens: 5 }, MODEL);
    const snap = b.consume({ inputTokens: 20, outputTokens: 10 }, MODEL);
    expect(snap.inputTokens).toBe(30);
    expect(snap.outputTokens).toBe(15);
    expect(snap.totalTokens).toBe(45);
  });
});
