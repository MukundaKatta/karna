import { describe, it, expect, vi } from "vitest";
import {
  requiresApproval,
  requestApproval,
  ApprovalTimeoutError,
  type ApprovalCallback,
} from "../../agent/src/tools/approval.js";
import type { ToolDefinitionRuntime, ToolPolicy } from "../../agent/src/tools/registry.js";

function mockTool(overrides: Partial<ToolDefinitionRuntime> = {}): ToolDefinitionRuntime {
  return {
    name: "test_tool",
    description: "Test tool for testing",
    parameters: { type: "object", properties: {} },
    riskLevel: "low",
    requiresApproval: false,
    timeout: 30_000,
    execute: async () => null,
    ...overrides,
  };
}

describe("Tool Approval - Extended", () => {
  describe("requiresApproval - combined scenarios", () => {
    it("policy override takes precedence over risk level", () => {
      const tool = mockTool({ name: "dangerous", riskLevel: "critical" });
      const policy: ToolPolicy = { approvalOverrides: { dangerous: false } };
      expect(requiresApproval(tool, policy)).toBe(false);
    });

    it("tool-level flag overrides risk-level default", () => {
      const tool = mockTool({ riskLevel: "low", requiresApproval: true });
      expect(requiresApproval(tool)).toBe(true);
    });

    it("policy can upgrade low-risk tool to require approval", () => {
      const tool = mockTool({ name: "safe", riskLevel: "low" });
      const policy: ToolPolicy = { approvalOverrides: { safe: true } };
      expect(requiresApproval(tool, policy)).toBe(true);
    });

    it("missing policy key falls through to tool defaults", () => {
      const tool = mockTool({ name: "other", riskLevel: "high" });
      const policy: ToolPolicy = { approvalOverrides: { different_tool: false } };
      expect(requiresApproval(tool, policy)).toBe(true);
    });
  });

  describe("requestApproval", () => {
    it("resolves with approved response", async () => {
      const callback: ApprovalCallback = async (req) => ({
        toolCallId: req.toolCallId,
        approved: true,
        respondedAt: Date.now(),
      });

      const tool = mockTool({ name: "shell_exec", riskLevel: "high" });
      const response = await requestApproval(
        callback, "tc-1", tool, { cmd: "ls" }, "session-1", "agent-1",
      );

      expect(response.approved).toBe(true);
      expect(response.toolCallId).toBe("tc-1");
    });

    it("resolves with rejected response", async () => {
      const callback: ApprovalCallback = async (req) => ({
        toolCallId: req.toolCallId,
        approved: false,
        reason: "Too dangerous",
        respondedAt: Date.now(),
      });

      const tool = mockTool({ name: "rm_rf", riskLevel: "critical" });
      const response = await requestApproval(
        callback, "tc-2", tool, {}, "session-1", "agent-1",
      );

      expect(response.approved).toBe(false);
      expect(response.reason).toBe("Too dangerous");
    });

    it("times out and returns rejected", async () => {
      const callback: ApprovalCallback = () =>
        new Promise(() => {}); // Never resolves

      const tool = mockTool({ name: "slow_tool", riskLevel: "high" });
      const response = await requestApproval(
        callback, "tc-3", tool, {}, "session-1", "agent-1", 50, // 50ms timeout
      );

      expect(response.approved).toBe(false);
      expect(response.reason).toContain("timed out");
    });
  });

  describe("ApprovalTimeoutError", () => {
    it("has correct properties", () => {
      const error = new ApprovalTimeoutError("tc-1", "shell_exec", 5000);
      expect(error.name).toBe("ApprovalTimeoutError");
      expect(error.toolCallId).toBe("tc-1");
      expect(error.toolName).toBe("shell_exec");
      expect(error.timeoutMs).toBe(5000);
      expect(error.message).toContain("shell_exec");
      expect(error.message).toContain("5000ms");
    });
  });
});
