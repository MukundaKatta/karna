import { describe, it, expect } from "vitest";
import { imageGenerateTool } from "../../agent/src/tools/builtin/image-generate.js";
import { applyPatchTool } from "../../agent/src/tools/builtin/apply-patch.js";
import { sessionsListTool, sessionsHistoryTool, sessionsSendTool } from "../../agent/src/tools/builtin/sessions.js";
import { memorySearchTool, memoryGetTool } from "../../agent/src/tools/builtin/memory-tools.js";
import { messageTool } from "../../agent/src/tools/builtin/message.js";
import { gatewayRestartTool, sessionStatusTool, sessionSpawnTool } from "../../agent/src/tools/builtin/gateway-control.js";

describe("New Tool Definitions", () => {
  const tools = [
    { tool: imageGenerateTool, name: "image_generate", risk: "low" },
    { tool: applyPatchTool, name: "apply_patch", risk: "medium" },
    { tool: sessionsListTool, name: "sessions_list", risk: "low" },
    { tool: sessionsHistoryTool, name: "sessions_history", risk: "low" },
    { tool: sessionsSendTool, name: "sessions_send", risk: "medium" },
    { tool: memorySearchTool, name: "memory_search", risk: "low" },
    { tool: memoryGetTool, name: "memory_get", risk: "low" },
    { tool: messageTool, name: "message", risk: "medium" },
    { tool: gatewayRestartTool, name: "gateway_restart", risk: "critical" },
    { tool: sessionStatusTool, name: "session_status", risk: "low" },
    { tool: sessionSpawnTool, name: "sessions_spawn", risk: "medium" },
  ];

  for (const { tool, name, risk } of tools) {
    describe(name, () => {
      it("has correct name", () => {
        expect(tool.name).toBe(name);
      });

      it("has non-empty description", () => {
        expect(tool.description.length).toBeGreaterThan(10);
      });

      it(`has risk level ${risk}`, () => {
        expect(tool.riskLevel).toBe(risk);
      });

      it("has valid parameters schema", () => {
        expect(tool.parameters.type).toBe("object");
        expect(tool.parameters.properties).toBeDefined();
      });

      it("has execute function", () => {
        expect(typeof tool.execute).toBe("function");
      });

      it("has timeout", () => {
        expect(tool.timeout).toBeGreaterThan(0);
      });

      it("has tags", () => {
        expect(tool.tags).toBeDefined();
        expect(tool.tags!.length).toBeGreaterThan(0);
      });
    });
  }

  describe("Tool registration count", () => {
    it("all 11 new tools have unique names", () => {
      const names = tools.map((t) => t.tool.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe("Approval requirements", () => {
    it("gateway_restart requires approval", () => {
      expect(gatewayRestartTool.requiresApproval).toBe(true);
    });

    it("sessions_send requires approval", () => {
      expect(sessionsSendTool.requiresApproval).toBe(true);
    });

    it("message requires approval", () => {
      expect(messageTool.requiresApproval).toBe(true);
    });

    it("sessions_spawn requires approval", () => {
      expect(sessionSpawnTool.requiresApproval).toBe(true);
    });

    it("memory_search does not require approval", () => {
      expect(memorySearchTool.requiresApproval).toBe(false);
    });

    it("sessions_list does not require approval", () => {
      expect(sessionsListTool.requiresApproval).toBe(false);
    });
  });
});
