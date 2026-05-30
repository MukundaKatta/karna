import { describe, it, expect } from "vitest";
import {
  CostAttributor,
  COST_UNATTRIBUTED,
} from "../../packages/shared/src/utils/cost-attribution.js";

const MODEL = "gpt-4o-mini";

describe("CostAttributor (#579)", () => {
  it("records events and totals cost + tokens", () => {
    const attr = new CostAttributor();
    attr.record({ sessionId: "s1", model: MODEL, usage: { inputTokens: 1000, outputTokens: 500 } });
    attr.record({ sessionId: "s1", model: MODEL, usage: { inputTokens: 2000, outputTokens: 100 } });
    const total = attr.total();
    expect(total.events).toBe(2);
    expect(total.inputTokens).toBe(3000);
    expect(total.outputTokens).toBe(600);
    expect(total.totalTokens).toBe(3600);
    expect(total.costUsd).toBeGreaterThan(0);
  });

  it("aggregates by user, bucketing missing dimensions as unattributed", () => {
    const attr = new CostAttributor();
    attr.record({ sessionId: "s1", userId: "u1", model: MODEL, usage: { inputTokens: 100, outputTokens: 0 } });
    attr.record({ sessionId: "s2", userId: "u2", model: MODEL, usage: { inputTokens: 200, outputTokens: 0 } });
    attr.record({ sessionId: "s3", model: MODEL, usage: { inputTokens: 50, outputTokens: 0 } });
    const byUser = attr.aggregateBy("userId");
    expect(byUser["u1"].inputTokens).toBe(100);
    expect(byUser["u2"].inputTokens).toBe(200);
    expect(byUser[COST_UNATTRIBUTED].inputTokens).toBe(50);
  });

  it("aggregates by tool and answers totalFor", () => {
    const attr = new CostAttributor();
    attr.record({ sessionId: "s1", toolName: "web_search", model: MODEL, usage: { inputTokens: 10, outputTokens: 0 } });
    attr.record({ sessionId: "s1", toolName: "web_search", model: MODEL, usage: { inputTokens: 30, outputTokens: 0 } });
    const byTool = attr.aggregateBy("toolName");
    expect(byTool["web_search"].events).toBe(2);
    expect(attr.totalFor("toolName", "web_search").inputTokens).toBe(40);
  });

  it("reset clears all events", () => {
    const attr = new CostAttributor();
    attr.record({ sessionId: "s1", model: MODEL, usage: { inputTokens: 1, outputTokens: 1 } });
    attr.reset();
    expect(attr.all()).toHaveLength(0);
    expect(attr.total().events).toBe(0);
  });
});
