import { describe, it, expect } from "vitest";
import { currentPhase, type AgentRun } from "../../apps/web/components/run-timeline";

function makeRun(overrides: Partial<AgentRun>): AgentRun {
  return {
    traceId: "t1",
    sessionId: "s1",
    agentId: "agent",
    startedAt: 1000,
    model: "claude",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    toolCalls: 0,
    success: true,
    spans: [],
    ...overrides,
  };
}

describe("currentPhase", () => {
  it("reports completed for a finished successful run", () => {
    const run = makeRun({ endedAt: 2000, success: true });
    expect(currentPhase(run).label).toBe("completed");
  });

  it("reports failed for a finished unsuccessful run", () => {
    const run = makeRun({ endedAt: 2000, success: false });
    expect(currentPhase(run).label).toBe("failed");
  });

  it("reports starting for an active run with no spans", () => {
    const run = makeRun({ endedAt: undefined, spans: [] });
    expect(currentPhase(run).label).toBe("starting");
  });

  it("uses the last open span's kind as the phase for an active run", () => {
    const run = makeRun({
      endedAt: undefined,
      spans: [
        { spanId: "a", name: "build-context", kind: "context", startedAt: 1000, endedAt: 1100, status: "ok" },
        { spanId: "b", name: "anthropic", kind: "model", startedAt: 1100, status: "ok" },
      ],
    });
    const phase = currentPhase(run);
    expect(phase.label).toBe("model");
    expect(phase.kind).toBe("model");
    expect(phase.tool).toBeUndefined();
  });

  it("surfaces the active tool name when an open tool span is running", () => {
    const run = makeRun({
      endedAt: undefined,
      spans: [
        { spanId: "a", name: "anthropic", kind: "model", startedAt: 1000, endedAt: 1100, status: "ok" },
        { spanId: "b", name: "web_search", kind: "tool", startedAt: 1100, status: "ok" },
      ],
    });
    const phase = currentPhase(run);
    expect(phase.label).toBe("tool");
    expect(phase.tool).toBe("web_search");
  });

  it("falls back to the most recent span when none are open", () => {
    const run = makeRun({
      endedAt: undefined,
      spans: [
        { spanId: "a", name: "anthropic", kind: "model", startedAt: 1000, endedAt: 1100, status: "ok" },
        { spanId: "b", name: "store", kind: "memory", startedAt: 1100, endedAt: 1200, status: "ok" },
      ],
    });
    expect(currentPhase(run).label).toBe("memory");
  });
});
