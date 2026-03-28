import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry, type ToolDefinitionRuntime } from "../../agent/src/tools/registry.js";

function createMockTool(overrides: Partial<ToolDefinitionRuntime> = {}): ToolDefinitionRuntime {
  return {
    name: overrides.name ?? "test_tool",
    description: "A test tool",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "Test input" },
      },
      required: ["input"],
    },
    riskLevel: "low",
    requiresApproval: false,
    timeout: 30_000,
    execute: async () => ({ result: "ok" }),
    ...overrides,
  };
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("registers and retrieves a tool", () => {
    const tool = createMockTool();
    registry.register(tool);
    expect(registry.get("test_tool")).toBe(tool);
    expect(registry.has("test_tool")).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("throws on duplicate registration", () => {
    registry.register(createMockTool());
    expect(() => registry.register(createMockTool())).toThrow('Tool "test_tool" is already registered');
  });

  it("unregisters a tool", () => {
    registry.register(createMockTool());
    expect(registry.unregister("test_tool")).toBe(true);
    expect(registry.has("test_tool")).toBe(false);
    expect(registry.size).toBe(0);
  });

  it("returns false when unregistering non-existent tool", () => {
    expect(registry.unregister("non_existent")).toBe(false);
  });

  it("returns undefined for non-existent tool", () => {
    expect(registry.get("non_existent")).toBeUndefined();
  });

  it("clears all tools", () => {
    registry.register(createMockTool({ name: "tool_a" }));
    registry.register(createMockTool({ name: "tool_b" }));
    expect(registry.size).toBe(2);
    registry.clear();
    expect(registry.size).toBe(0);
  });

  describe("policy filtering", () => {
    beforeEach(() => {
      registry.register(createMockTool({ name: "shell_exec", riskLevel: "high" }));
      registry.register(createMockTool({ name: "file_read", riskLevel: "low" }));
      registry.register(createMockTool({ name: "web_search", riskLevel: "medium" }));
    });

    it("filters by allowList", () => {
      const tools = registry.getTools({ allowList: ["file_read", "web_search"] });
      expect(tools.map((t) => t.name)).toEqual(["file_read", "web_search"]);
    });

    it("filters by denyList", () => {
      const tools = registry.getTools({ denyList: ["shell_exec"] });
      expect(tools.map((t) => t.name)).toEqual(["file_read", "web_search"]);
    });

    it("applies approval overrides", () => {
      const tools = registry.getTools({
        approvalOverrides: { file_read: true },
      });
      const fileRead = tools.find((t) => t.name === "file_read");
      expect(fileRead?.requiresApproval).toBe(true);
    });

    it("returns all tools with no policy", () => {
      const tools = registry.getTools();
      expect(tools.length).toBe(3);
    });
  });

  describe("getChatTools", () => {
    it("converts tools to LLM-compatible format", () => {
      registry.register(createMockTool({ name: "test" }));
      const chatTools = registry.getChatTools();
      expect(chatTools).toHaveLength(1);
      expect(chatTools[0]).toEqual({
        name: "test",
        description: "A test tool",
        parameters: {
          type: "object",
          properties: { input: { type: "string", description: "Test input" } },
          required: ["input"],
        },
      });
      // Should NOT include execute function
      expect(chatTools[0]).not.toHaveProperty("execute");
      expect(chatTools[0]).not.toHaveProperty("riskLevel");
    });
  });
});
