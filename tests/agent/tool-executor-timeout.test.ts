import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../../agent/src/tools/registry.js";
import {
  TOOL_TIMEOUT_ERROR_CODE,
  executeTool,
  getToolTimeoutMetrics,
  resetToolTimeoutMetricsForTests,
  resolveToolTimeout,
} from "../../agent/src/tools/executor.js";

function createTool(
  overrides: Partial<ToolDefinitionRuntime>,
): ToolDefinitionRuntime {
  return {
    name: "slow_tool",
    description: "Slow tool",
    parameters: { type: "object", properties: {} },
    riskLevel: "low",
    requiresApproval: false,
    timeout: 10_000,
    async execute() {
      return "ok";
    },
    ...overrides,
  };
}

const context: ToolExecutionContext = {
  sessionId: "session-1",
  agentId: "agent-1",
};

describe("tool executor timeouts", () => {
  beforeEach(() => {
    resetToolTimeoutMetricsForTests();
  });

  it("uses risk-level defaults when a tool does not provide a timeout", () => {
    expect(resolveToolTimeout(createTool({ riskLevel: "low", timeout: 0 }))).toBe(10_000);
    expect(resolveToolTimeout(createTool({ riskLevel: "medium", timeout: 0 }))).toBe(30_000);
    expect(resolveToolTimeout(createTool({ riskLevel: "high", timeout: 0 }))).toBe(60_000);
    expect(resolveToolTimeout(createTool({ riskLevel: "critical", timeout: 0 }))).toBe(120_000);
  });

  it("aborts and returns TOOL_TIMEOUT when a tool hangs", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const tool = createTool({
      timeout: 50,
      async execute(_input, executionContext) {
        observedSignal = executionContext.signal;
        return new Promise((resolve) => {
          executionContext.signal?.addEventListener("abort", () => resolve("aborted"));
        });
      },
    });

    const resultPromise = executeTool(tool, {}, context);
    await vi.advanceTimersByTimeAsync(50);
    const result = await resultPromise;

    expect(observedSignal?.aborted).toBe(true);
    expect(result).toMatchObject({
      output: null,
      isError: true,
      errorCode: TOOL_TIMEOUT_ERROR_CODE,
    });
    expect(result.errorMessage).toContain('Tool "slow_tool" timed out after 50ms');
    expect(getToolTimeoutMetrics()).toEqual({ slow_tool: 1 });
    vi.useRealTimers();
  });
});
