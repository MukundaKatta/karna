// ─── Delegate to Agent Tool ──────────────────────────────────────────────────
//
// A built-in tool that allows agents to delegate tasks to other specialized
// agents. The actual execution is intercepted by the Orchestrator — the tool
// handler here is a placeholder that returns a sentinel value.
//
// ──────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import type { ToolDefinitionRuntime } from "../registry.js";

const DelegateInputSchema = z.object({
  agentId: z
    .string()
    .min(1)
    .describe("The ID of the specialized agent to delegate to."),
  task: z
    .string()
    .min(1)
    .describe("A clear description of the task to delegate."),
  context: z
    .string()
    .optional()
    .describe("Optional context or background information for the delegate agent."),
});

/**
 * Sentinel value returned by the delegate tool.
 * The orchestrator intercepts `delegate_to_agent` tool calls before they
 * reach this handler, but if the tool is ever called directly (without
 * orchestrator interception), this sentinel lets the caller know.
 */
export const DELEGATE_TOOL_NAME = "delegate_to_agent";

export const delegateToAgentTool: ToolDefinitionRuntime = {
  name: DELEGATE_TOOL_NAME,
  description:
    "Delegate a task to a specialized agent. Use when the current task requires " +
    "expertise or capabilities that a different agent is better suited for. " +
    "Available agents and their specializations are described in the system prompt.",
  parameters: {
    type: "object",
    properties: {
      agentId: {
        type: "string",
        description: "The ID of the specialized agent to delegate to.",
      },
      task: {
        type: "string",
        description: "A clear description of the task to delegate.",
      },
      context: {
        type: "string",
        description:
          "Optional context or background information for the delegate agent.",
      },
    },
    required: ["agentId", "task"],
  },
  inputSchema: DelegateInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 120_000, // Delegations can take longer since they invoke another agent
  tags: ["orchestration", "delegation", "multi-agent"],

  /**
   * Placeholder execute handler. In normal operation, the Orchestrator
   * intercepts delegate_to_agent tool calls and handles them directly.
   * This handler only fires if the tool is called outside of orchestration.
   */
  async execute(input) {
    return {
      status: "not_intercepted",
      message:
        "The delegate_to_agent tool was called but not intercepted by an orchestrator. " +
        "Delegation requires the Orchestrator to be active.",
      requestedAgent: input["agentId"],
      task: input["task"],
    };
  },
};
