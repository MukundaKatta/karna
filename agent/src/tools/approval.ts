// ─── Human-in-the-Loop Tool Approval ───────────────────────────────────────

import pino from "pino";
import type { ToolRiskLevel } from "@karna/shared/types/tool.js";
import type { ToolDefinitionRuntime, ToolPolicy } from "./registry.js";

const logger = pino({ name: "tool-approval" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ApprovalRequest {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  riskLevel: ToolRiskLevel;
  description?: string;
  sessionId: string;
  agentId: string;
  requestedAt: number;
}

export interface ApprovalResponse {
  toolCallId: string;
  approved: boolean;
  reason?: string;
  respondedAt: number;
  respondedBy?: string;
}

/**
 * Callback invoked to request approval from a human operator.
 * The implementation is provided by the channel/gateway layer.
 */
export type ApprovalCallback = (request: ApprovalRequest) => Promise<ApprovalResponse>;

// ─── Default Risk Thresholds ────────────────────────────────────────────────

/**
 * Risk levels that require approval by default.
 * "high" and "critical" tools always need human confirmation.
 */
const DEFAULT_APPROVAL_RISK_LEVELS: Set<ToolRiskLevel> = new Set(["high", "critical"]);

// ─── Approval Logic ─────────────────────────────────────────────────────────

/**
 * Determine whether a tool execution requires human approval.
 *
 * Priority:
 * 1. Agent policy overrides (per-tool)
 * 2. Tool-level requiresApproval flag
 * 3. Risk-level default thresholds
 */
export function requiresApproval(
  tool: ToolDefinitionRuntime,
  policy?: ToolPolicy
): boolean {
  // Check agent policy overrides first
  if (policy?.approvalOverrides) {
    const override = policy.approvalOverrides[tool.name];
    if (override !== undefined) {
      return override;
    }
  }

  // Check tool-level flag
  if (tool.requiresApproval) {
    return true;
  }

  // Fall back to risk-level defaults
  return DEFAULT_APPROVAL_RISK_LEVELS.has(tool.riskLevel);
}

/**
 * Request approval from a human operator and wait for the response.
 *
 * @param callback - The approval callback injected by the runtime
 * @param toolCallId - Unique ID for this tool invocation
 * @param tool - The tool definition
 * @param args - The arguments the model wants to pass
 * @param sessionId - Current session
 * @param agentId - Current agent
 * @param timeoutMs - How long to wait for approval (default: 5 minutes)
 */
export async function requestApproval(
  callback: ApprovalCallback,
  toolCallId: string,
  tool: ToolDefinitionRuntime,
  args: Record<string, unknown>,
  sessionId: string,
  agentId: string,
  timeoutMs = 300_000
): Promise<ApprovalResponse> {
  const request: ApprovalRequest = {
    toolCallId,
    toolName: tool.name,
    arguments: args,
    riskLevel: tool.riskLevel,
    description: buildApprovalDescription(tool, args),
    sessionId,
    agentId,
    requestedAt: Date.now(),
  };

  logger.info(
    { toolCallId, tool: tool.name, riskLevel: tool.riskLevel, sessionId },
    "Requesting tool approval"
  );

  const approvalPromise = callback(request);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new ApprovalTimeoutError(toolCallId, tool.name, timeoutMs)),
      timeoutMs
    );
  });

  try {
    const response = await Promise.race([approvalPromise, timeoutPromise]);
    logger.info(
      { toolCallId, approved: response.approved, reason: response.reason },
      "Approval response received"
    );
    return response;
  } catch (error) {
    if (error instanceof ApprovalTimeoutError) {
      logger.warn({ toolCallId, tool: tool.name, timeoutMs }, "Approval request timed out");
      return {
        toolCallId,
        approved: false,
        reason: `Approval timed out after ${timeoutMs}ms`,
        respondedAt: Date.now(),
      };
    }
    throw error;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildApprovalDescription(
  tool: ToolDefinitionRuntime,
  args: Record<string, unknown>
): string {
  const argSummary = Object.entries(args)
    .map(([key, value]) => {
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      const truncated = strValue.length > 100 ? strValue.slice(0, 100) + "..." : strValue;
      return `  ${key}: ${truncated}`;
    })
    .join("\n");

  return `Tool: ${tool.name} [${tool.riskLevel}]\n${tool.description}\n\nArguments:\n${argSummary}`;
}

// ─── Errors ───────────────────────────────────────────────────────────────

export class ApprovalTimeoutError extends Error {
  constructor(
    public readonly toolCallId: string,
    public readonly toolName: string,
    public readonly timeoutMs: number
  ) {
    super(`Approval for tool "${toolName}" (${toolCallId}) timed out after ${timeoutMs}ms`);
    this.name = "ApprovalTimeoutError";
  }
}
