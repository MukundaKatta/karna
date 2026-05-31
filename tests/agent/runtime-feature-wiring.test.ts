import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@karna/shared/types/session.js";
import { AgentRuntime } from "../../agent/src/runtime.js";
import { ToolRegistry, type ToolDefinitionRuntime } from "../../agent/src/tools/registry.js";

// The runtime selects its provider via routeModel(), so we mock it (mirroring
// tests/agent/runtime-tool-denial.test.ts). Turn 1 requests the tool; turn 2
// replies with text so the loop terminates.
const routeMock = vi.hoisted(() => {
  const calls: unknown[] = [];
  const provider = {
    name: "fake-provider",
    async *chat(params: unknown) {
      calls.push(params);
      if (calls.length === 1) {
        yield { type: "tool_use" as const, id: "c1", name: "danger_tool", input: { x: 1 } };
        yield { type: "done" as const };
      } else {
        yield { type: "text" as const, text: "all done" };
        yield { type: "done" as const };
      }
    },
  };
  return { calls, provider };
});

vi.mock("../../agent/src/models/router.js", () => ({
  routeModel: () => ({ provider: routeMock.provider, model: "fake-model", complexity: "simple" }),
}));

function makeSession(): Session {
  const now = Date.now();
  return {
    id: "s1",
    channelType: "webchat",
    channelId: "c1",
    userId: "u1",
    status: "active",
    createdAt: now,
    updatedAt: now,
    context: { tools: ["danger_tool"] },
  } as unknown as Session;
}

const AGENT = {
  id: "karna-general",
  name: "Karna",
  defaultProvider: "openai",
  defaultModel: "fake-model",
} as never;

function registerDangerTool(registry: ToolRegistry, exec: () => Promise<unknown>) {
  registry.register({
    name: "danger_tool",
    description: "does something",
    parameters: { type: "object", properties: {} },
    riskLevel: "high",
    requiresApproval: false,
    timeout: 5000,
    execute: exec,
  } as ToolDefinitionRuntime);
}

describe("runtime feature wiring (#556/#552/#548/#547)", () => {
  beforeEach(() => {
    routeMock.calls.length = 0;
  });

  it("a policy 'deny' rule blocks the tool without executing it", async () => {
    const registry = new ToolRegistry();
    const exec = vi.fn(async () => "should-not-run");
    registerDangerTool(registry, exec);

    const rt = new AgentRuntime(registry, undefined, undefined, {
      features: {
        toolPolicyRules: [
          { id: "deny-danger", decision: "deny", priority: 100, when: { tools: ["danger_tool"] } },
        ],
      },
    });
    await rt.init();

    await rt.run({ message: "do it", session: makeSession(), agent: AGENT, conversationHistory: [] });

    expect(exec).not.toHaveBeenCalled();
    const audit = rt.getPolicyAuditLog();
    expect(audit.some((e) => e.decision === "deny" && e.input.toolName === "danger_tool")).toBe(true);
  });

  it("default-allow runs the tool and audits the decision", async () => {
    const registry = new ToolRegistry();
    const exec = vi.fn(async () => "ran");
    registerDangerTool(registry, exec);

    const rt = new AgentRuntime(registry, undefined, undefined, {});
    // The tool is high-risk, so it still flows through the approval gate; approve
    // it so we exercise the (allowed) execution + audit path.
    rt.setApprovalCallback(async (request) => ({
      toolCallId: request.toolCallId,
      approved: true,
      respondedAt: Date.now(),
    }));
    await rt.init();

    await rt.run({ message: "do it", session: makeSession(), agent: AGENT, conversationHistory: [] });

    expect(exec).toHaveBeenCalledTimes(1);
    const audit = rt.getPolicyAuditLog();
    expect(audit.some((e) => e.decision === "allow" && e.input.toolName === "danger_tool")).toBe(true);
  });
});
