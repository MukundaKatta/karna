import { describe, it, expect } from "vitest";
import { requiresApproval } from "../../agent/src/tools/approval.js";
import type { ToolDefinitionRuntime, ToolPolicy } from "../../agent/src/tools/registry.js";

function mockTool(overrides: Partial<ToolDefinitionRuntime> = {}): ToolDefinitionRuntime {
  return {
    name: "test_tool",
    description: "Test",
    parameters: { type: "object", properties: {} },
    riskLevel: "low",
    requiresApproval: false,
    timeout: 30_000,
    execute: async () => null,
    ...overrides,
  };
}

describe("Tool Approval", () => {
  describe("requiresApproval", () => {
    it("returns false for low-risk tools by default", () => {
      const tool = mockTool({ riskLevel: "low" });
      expect(requiresApproval(tool)).toBe(false);
    });

    it("returns false for medium-risk tools by default", () => {
      const tool = mockTool({ riskLevel: "medium" });
      expect(requiresApproval(tool)).toBe(false);
    });

    it("returns true for high-risk tools", () => {
      const tool = mockTool({ riskLevel: "high" });
      expect(requiresApproval(tool)).toBe(true);
    });

    it("returns true for critical-risk tools", () => {
      const tool = mockTool({ riskLevel: "critical" });
      expect(requiresApproval(tool)).toBe(true);
    });

    it("respects the tool-level requiresApproval flag", () => {
      const tool = mockTool({ riskLevel: "low", requiresApproval: true });
      expect(requiresApproval(tool)).toBe(true);
    });

    it("uses policy overrides over tool defaults", () => {
      const tool = mockTool({ name: "shell_exec", riskLevel: "high" });
      const policy: ToolPolicy = {
        approvalOverrides: { shell_exec: false },
      };
      expect(requiresApproval(tool, policy)).toBe(false);
    });

    it("policy can require approval for low-risk tools", () => {
      const tool = mockTool({ name: "file_read", riskLevel: "low" });
      const policy: ToolPolicy = {
        approvalOverrides: { file_read: true },
      };
      expect(requiresApproval(tool, policy)).toBe(true);
    });
  });
});
