import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../agent/src/tools/registry.js";
import { allBuiltinTools, registerBuiltinTools } from "../../agent/src/tools/builtin/index.js";

describe("Tool Registration — All Built-in Tools", () => {
  it("registers all built-in tools without errors", () => {
    const registry = new ToolRegistry();
    expect(() => registerBuiltinTools(registry)).not.toThrow();
  });

  it("has the expected total number of tools", () => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry);
    // Original: shell, 4 files, web_search, 5 calendar, 5 email, 6 browser,
    // code_exec, 3 reminder, 6 notes, 2 screenshot, 5 mcp = 39
    // New: image_generate, apply_patch, 3 sessions, 2 memory, message,
    // gateway_restart, session_status, sessions_spawn = 11
    // Total: 50
    expect(registry.size).toBe(allBuiltinTools.length);
    expect(registry.size).toBeGreaterThanOrEqual(45);
  });

  it("all tools have unique names", () => {
    const names = allBuiltinTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("all tools have descriptions", () => {
    for (const tool of allBuiltinTools) {
      expect(tool.description.length, `${tool.name} missing description`).toBeGreaterThan(0);
    }
  });

  it("all tools have valid risk levels", () => {
    const validLevels = new Set(["low", "medium", "high", "critical"]);
    for (const tool of allBuiltinTools) {
      expect(validLevels.has(tool.riskLevel), `${tool.name} has invalid risk level: ${tool.riskLevel}`).toBe(true);
    }
  });

  it("all tools have valid parameter schemas", () => {
    for (const tool of allBuiltinTools) {
      expect(tool.parameters.type, `${tool.name} missing parameters.type`).toBe("object");
    }
  });

  it("all tools have execute functions", () => {
    for (const tool of allBuiltinTools) {
      expect(typeof tool.execute, `${tool.name} missing execute`).toBe("function");
    }
  });

  it("all tools have positive timeouts", () => {
    for (const tool of allBuiltinTools) {
      expect(tool.timeout, `${tool.name} has non-positive timeout`).toBeGreaterThan(0);
    }
  });

  it("critical tools require approval", () => {
    for (const tool of allBuiltinTools) {
      if (tool.riskLevel === "critical") {
        expect(tool.requiresApproval, `Critical tool ${tool.name} should require approval`).toBe(true);
      }
    }
  });

  it("high-risk tools require approval by default", () => {
    for (const tool of allBuiltinTools) {
      if (tool.riskLevel === "high") {
        expect(tool.requiresApproval, `High-risk tool ${tool.name} should require approval`).toBe(true);
      }
    }
  });

  describe("Tool lookup", () => {
    it("can retrieve each tool by name", () => {
      const registry = new ToolRegistry();
      registerBuiltinTools(registry);

      for (const tool of allBuiltinTools) {
        const found = registry.get(tool.name);
        expect(found, `Tool ${tool.name} not found in registry`).toBeDefined();
        expect(found!.name).toBe(tool.name);
      }
    });
  });

  describe("Chat tools conversion", () => {
    it("converts all tools to LLM-compatible format", () => {
      const registry = new ToolRegistry();
      registerBuiltinTools(registry);
      const chatTools = registry.getChatTools();

      expect(chatTools.length).toBe(allBuiltinTools.length);

      for (const ct of chatTools) {
        expect(ct).toHaveProperty("name");
        expect(ct).toHaveProperty("description");
        expect(ct).toHaveProperty("parameters");
        // Should NOT have execute, riskLevel, etc.
        expect(ct).not.toHaveProperty("execute");
        expect(ct).not.toHaveProperty("riskLevel");
        expect(ct).not.toHaveProperty("timeout");
      }
    });
  });
});
