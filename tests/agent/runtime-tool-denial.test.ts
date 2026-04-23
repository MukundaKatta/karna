import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@karna/shared/types/session.js";
import { AgentRuntime } from "../../agent/src/runtime.js";
import { ToolRegistry } from "../../agent/src/tools/registry.js";

const routeMock = vi.hoisted(() => {
  const calls: unknown[] = [];
  const provider = {
    name: "fake-provider",
    async *chat(params: unknown) {
      calls.push(params);

      if (calls.length > 1) {
        throw new Error("unexpected second model call after denied tool");
      }

      yield {
        type: "tool_use" as const,
        id: "call_shell_1",
        name: "shell_exec",
        input: { command: "ls -F" },
      };
      yield { type: "done" as const };
    },
  };

  return { calls, provider };
});

vi.mock("../../agent/src/models/router.js", () => ({
  routeModel: () => ({
    provider: routeMock.provider,
    model: "fake-model",
    complexity: "simple",
  }),
}));

describe("AgentRuntime denied tool approvals", () => {
  beforeEach(() => {
    routeMock.calls.length = 0;
  });

  it("returns a safe final response without a second provider call when all tools are denied", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "shell_exec",
      description: "Run a shell command.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
      riskLevel: "medium",
      requiresApproval: true,
      timeout: 1_000,
      execute: vi.fn(),
    });

    const runtime = new AgentRuntime(registry);
    runtime.setApprovalCallback(async (request) => ({
      toolCallId: request.toolCallId,
      approved: false,
      reason: "Mobile approvals are unavailable",
      respondedAt: Date.now(),
    }));
    await runtime.init();

    const now = Date.now();
    const session: Session = {
      id: "session-1",
      channelType: "mobile",
      channelId: "device-1",
      userId: "user-1",
      status: "active",
      createdAt: now,
      updatedAt: now,
      context: { tools: ["shell_exec"] },
    };

    const result = await runtime.run({
      message: "Use shell_exec to list the current directory.",
      session,
      agent: {
        id: "karna-general",
        name: "Karna",
        defaultProvider: "openai",
        defaultModel: "fake-model",
      },
      conversationHistory: [],
    });

    expect(routeMock.calls).toHaveLength(1);
    expect(result.success).toBe(true);
    expect(result.response).toContain("couldn't run the shell_exec tool");
    expect(result.response).toContain("No action was taken");
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        id: "call_shell_1",
        name: "shell_exec",
        approved: false,
      }),
    ]);
  });
});
