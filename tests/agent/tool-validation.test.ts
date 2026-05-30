// ─── Tool Validation Tests (Issue #547) ──────────────────────────────────────

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  validateAgainstSchema,
  validateToolInput,
  validateToolOutput,
} from "../../agent/src/tools/validation.js";
import type { ToolDefinitionRuntime } from "../../agent/src/tools/registry.js";

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

describe("validateAgainstSchema", () => {
  it("returns ok with parsed data on success", () => {
    const schema = z.object({ n: z.number() });
    const res = validateAgainstSchema(schema, { n: 5 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ n: 5 });
  });

  it("returns structured issues on failure", () => {
    const schema = z.object({ n: z.number() });
    const res = validateAgainstSchema(schema, { n: "x" }, "input");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Invalid input/);
      expect(res.issues[0].path).toBe("n");
      expect(res.issues.length).toBe(1);
    }
  });
});

describe("validateToolInput", () => {
  it("passes through when no inputSchema (preserves existing behavior)", () => {
    const tool = makeTool();
    const res = validateToolInput(tool, { anything: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual({ anything: true });
  });

  it("validates when inputSchema present", () => {
    const tool = makeTool({ inputSchema: z.object({ q: z.string() }) });
    const bad = validateToolInput(tool, { q: 123 });
    expect(bad.ok).toBe(false);
    const good = validateToolInput(tool, { q: "hi" });
    expect(good.ok).toBe(true);
  });

  it("includes the tool name in the error message", () => {
    const tool = makeTool({ name: "search", inputSchema: z.object({ q: z.string() }) });
    const res = validateToolInput(tool, {});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/search/);
  });
});

describe("validateToolOutput", () => {
  it("passes through when no outputSchema", () => {
    const tool = makeTool();
    const res = validateToolOutput(tool, { weird: 1 });
    expect(res.ok).toBe(true);
  });

  it("validates output when outputSchema present", () => {
    const tool = makeTool({ outputSchema: z.object({ ok: z.boolean() }) });
    expect(validateToolOutput(tool, { ok: true }).ok).toBe(true);
    expect(validateToolOutput(tool, { ok: "no" }).ok).toBe(false);
  });
});
