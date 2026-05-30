// ─── Tool Dry-Run / Preview Tests (Issue #551) ───────────────────────────────

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  previewToolCall,
  supportsDryRun,
  type DryRunnableTool,
} from "../../agent/src/tools/dry-run.js";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../../agent/src/tools/registry.js";

function makeContext(): ToolExecutionContext {
  return { sessionId: "s1", agentId: "a1" };
}

function makeTool(overrides: Partial<DryRunnableTool> = {}): DryRunnableTool {
  return {
    name: "test_tool",
    description: "A test tool",
    parameters: { type: "object", properties: {} },
    riskLevel: "medium",
    requiresApproval: true,
    timeout: 5000,
    execute: async () => ({ ok: true }),
    ...overrides,
  };
}

describe("previewToolCall", () => {
  it("returns a generic preview when no dryRun is defined", async () => {
    const tool = makeTool();
    const preview = await previewToolCall(tool, { a: 1, b: 2 }, makeContext());
    expect(preview.simulated).toBe(false);
    expect(preview.toolName).toBe("test_tool");
    expect(preview.riskLevel).toBe("medium");
    expect(preview.requiresApproval).toBe(true);
    expect(preview.summary).toMatch(/test_tool/);
    expect(preview.summary).toMatch(/2 arguments/);
  });

  it("uses the tool's dryRun (string outcome)", async () => {
    const tool = makeTool({
      dryRun: (input) => `Would write ${(input as { path?: string }).path}`,
    });
    const preview = await previewToolCall(tool, { path: "/tmp/x" }, makeContext());
    expect(preview.simulated).toBe(true);
    expect(preview.summary).toBe("Would write /tmp/x");
  });

  it("uses the tool's dryRun (object outcome with detail)", async () => {
    const tool = makeTool({
      dryRun: () => ({ summary: "preview", detail: { cmd: "ls" } }),
    });
    const preview = await previewToolCall(tool, {}, makeContext());
    expect(preview.simulated).toBe(true);
    expect(preview.summary).toBe("preview");
    expect(preview.detail).toEqual({ cmd: "ls" });
  });

  it("does NOT execute the tool", async () => {
    let executed = false;
    const tool = makeTool({
      execute: async () => {
        executed = true;
        return null;
      },
    });
    await previewToolCall(tool, {}, makeContext());
    expect(executed).toBe(false);
  });

  it("surfaces validation errors without throwing", async () => {
    const tool = makeTool({ inputSchema: z.object({ q: z.string() }) });
    const preview = await previewToolCall(tool, { q: 123 }, makeContext());
    expect(preview.validationError).toMatch(/Invalid/);
  });

  it("falls back to generic preview if dryRun throws", async () => {
    const tool = makeTool({
      dryRun: () => {
        throw new Error("boom");
      },
    });
    const preview = await previewToolCall(tool, {}, makeContext());
    expect(preview.simulated).toBe(false);
    expect(preview.detail).toEqual({ dryRunError: "boom" });
  });
});

describe("supportsDryRun", () => {
  it("detects the dryRun capability", () => {
    expect(supportsDryRun(makeTool())).toBe(false);
    expect(supportsDryRun(makeTool({ dryRun: () => "x" }))).toBe(true);
  });
});
