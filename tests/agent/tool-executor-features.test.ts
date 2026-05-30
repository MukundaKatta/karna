// ─── Tool Executor Opt-In Features Tests (Issues #547/#548/#552) ──────────────

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { executeTool, TOOL_RATE_LIMITED_ERROR_CODE } from "../../agent/src/tools/executor.js";
import { ToolResultCache } from "../../agent/src/tools/result-cache.js";
import { ToolRateLimiter } from "../../agent/src/tools/rate-limiter.js";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../../agent/src/tools/registry.js";

function makeContext(): ToolExecutionContext {
  return { sessionId: "s1", agentId: "a1" };
}

function makeTool(overrides: Partial<ToolDefinitionRuntime> = {}): ToolDefinitionRuntime {
  return {
    name: "test_tool",
    description: "A test tool",
    parameters: { type: "object", properties: {} },
    riskLevel: "low",
    requiresApproval: false,
    timeout: 5000,
    execute: async () => ({ ok: true }),
    ...overrides,
  };
}

describe("executeTool with no options (backward compatible)", () => {
  it("executes normally without any feature options", async () => {
    const result = await executeTool(makeTool(), {}, makeContext());
    expect(result.isError).toBe(false);
    expect(result.output).toEqual({ ok: true });
  });

  it("still validates input via inputSchema as before", async () => {
    const tool = makeTool({ inputSchema: z.object({ q: z.string() }) });
    const result = await executeTool(tool, { q: 5 }, makeContext());
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toMatch(/Invalid/);
  });
});

describe("executeTool with result cache (Issue #548)", () => {
  it("serves the second call from cache without re-executing", async () => {
    let calls = 0;
    const tool = makeTool({
      execute: async () => {
        calls += 1;
        return { n: calls };
      },
    });
    const cache = new ToolResultCache({ test_tool: { enabled: true, ttlMs: 10000 } });

    const r1 = await executeTool(tool, { a: 1 }, makeContext(), { cache });
    const r2 = await executeTool(tool, { a: 1 }, makeContext(), { cache });

    expect(r1.output).toEqual({ n: 1 });
    expect(r2.output).toEqual({ n: 1 });
    expect(calls).toBe(1);
    expect(cache.stats().hits).toBe(1);
  });
});

describe("executeTool with rate limiter (Issue #552)", () => {
  it("returns a rate-limited error when no slot is available in time", async () => {
    const limiter = new ToolRateLimiter({ test_tool: { maxConcurrent: 1, maxWaitMs: 20 } });
    const tool = makeTool({
      execute: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 100)),
    });

    const first = executeTool(tool, {}, makeContext(), { rateLimiter: limiter });
    // Give the first call time to acquire the only slot.
    await new Promise((r) => setTimeout(r, 5));
    const second = await executeTool(tool, {}, makeContext(), { rateLimiter: limiter });

    expect(second.isError).toBe(true);
    expect(second.errorCode).toBe(TOOL_RATE_LIMITED_ERROR_CODE);

    await first;
    // Slot should be released after the first call completes.
    expect(limiter.stats("test_tool").active).toBe(0);
  });
});

describe("executeTool with output validation (Issue #547)", () => {
  it("errors when output fails outputSchema and validateOutput is on", async () => {
    const tool = makeTool({
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: "nope" }),
    });
    const result = await executeTool(tool, {}, makeContext(), { validateOutput: true });
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toMatch(/Invalid output/);
  });

  it("ignores output mismatch when validateOutput is off (default)", async () => {
    const tool = makeTool({
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: "nope" }),
    });
    const result = await executeTool(tool, {}, makeContext());
    expect(result.isError).toBe(false);
  });
});
