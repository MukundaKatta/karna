// ─── Gateway Control Tools ──────────────────────────────────────────────────
// Tools for managing the gateway from within an agent turn.
// Includes restart, status check, and session management.

import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-gateway" });

// ─── Gateway Restart ────────────────────────────────────────────────────────

export const gatewayRestartTool: ToolDefinitionRuntime = {
  name: "gateway_restart",
  description:
    "Restart the Karna gateway process. Use only when the gateway is in a bad state " +
    "or after configuration changes that require a restart.",
  parameters: {
    type: "object",
    properties: {},
  },
  riskLevel: "critical",
  requiresApproval: true,
  timeout: 5_000,
  tags: ["system", "gateway"],

  async execute(_input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    logger.warn({ sessionId: context.sessionId }, "Gateway restart requested by agent");

    try {
      const gatewayUrl = process.env["GATEWAY_URL"] ?? "http://localhost:18789";
      const response = await fetch(`${gatewayUrl}/api/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: context.sessionId }),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      return { success: true, message: "Gateway restart initiated" };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
};

// ─── Session Status ─────────────────────────────────────────────────────────

const SessionStatusInputSchema = z.object({
  sessionId: z.string().optional().describe("Session ID to check. Defaults to current session."),
});

export const sessionStatusTool: ToolDefinitionRuntime = {
  name: "session_status",
  description:
    "Get detailed status of a session including message count, token usage, " +
    "uptime, channel type, and current settings.",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Session ID (defaults to current)" },
    },
  },
  inputSchema: SessionStatusInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["sessions"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    const params = SessionStatusInputSchema.parse(input);
    const targetId = params.sessionId ?? context.sessionId;

    try {
      const gatewayUrl = process.env["GATEWAY_URL"] ?? "http://localhost:18789";
      const response = await fetch(`${gatewayUrl}/api/sessions`);
      if (!response.ok) return { error: `HTTP ${response.status}` };

      const data = await response.json() as { sessions: Array<Record<string, unknown>> };
      const session = data.sessions.find((s) => s["id"] === targetId);

      if (!session) return { error: `Session ${targetId} not found` };

      return {
        sessionId: targetId,
        ...session,
        isCurrent: targetId === context.sessionId,
      };
    } catch (error) {
      return { error: String(error) };
    }
  },
};

// ─── Session Spawn ──────────────────────────────────────────────────────────

const SessionSpawnInputSchema = z.object({
  agentId: z.string().min(1).describe("Agent ID for the new session"),
  channelType: z.string().min(1).describe("Channel type (webchat, internal)"),
  initialMessage: z.string().optional().describe("Optional message to send to the new session"),
});

export const sessionSpawnTool: ToolDefinitionRuntime = {
  name: "sessions_spawn",
  description:
    "Spawn a new isolated agent session. The new session runs independently " +
    "with its own conversation history. Useful for delegating sub-tasks to " +
    "specialized agents or running parallel workflows.",
  parameters: {
    type: "object",
    properties: {
      agentId: { type: "string", description: "Agent ID for the new session" },
      channelType: { type: "string", description: "Channel type" },
      initialMessage: { type: "string", description: "Initial message for the new session" },
    },
    required: ["agentId", "channelType"],
  },
  inputSchema: SessionSpawnInputSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: 10_000,
  tags: ["sessions", "multi-agent"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    const params = SessionSpawnInputSchema.parse(input);
    logger.info(
      { parentSession: context.sessionId, agentId: params.agentId },
      "Spawning new session",
    );

    try {
      const gatewayUrl = process.env["GATEWAY_URL"] ?? "http://localhost:18789";
      const response = await fetch(`${gatewayUrl}/api/sessions/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: params.agentId,
          channelType: params.channelType,
          initialMessage: params.initialMessage,
          parentSessionId: context.sessionId,
        }),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data = await response.json() as { sessionId: string };
      return {
        success: true,
        sessionId: data.sessionId,
        agentId: params.agentId,
        parentSessionId: context.sessionId,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
};
