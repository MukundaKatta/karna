// ─── Inter-Agent Session Tools ──────────────────────────────────────────────
// Enables agents to discover, read from, and message other sessions.
// Modeled after OpenClaw's sessions_list, sessions_history, sessions_send.

import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-sessions" });

// ─── Sessions List ──────────────────────────────────────────────────────────

const SessionsListInputSchema = z.object({
  status: z.enum(["active", "idle", "all"]).optional()
    .describe("Filter by session status. Default: active"),
});

export const sessionsListTool: ToolDefinitionRuntime = {
  name: "sessions_list",
  description:
    "List all active sessions on the gateway. Shows session IDs, channel types, " +
    "agent IDs, and basic stats. Use to discover what other agents/sessions are running.",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", description: "Filter by status", enum: ["active", "idle", "all"] },
    },
  },
  inputSchema: SessionsListInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["sessions", "multi-agent"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    // This tool needs gateway access — it's wired up via the runtime
    // For now, return the context we have
    logger.debug({ sessionId: context.sessionId }, "Listing sessions");

    try {
      const gatewayUrl = process.env["GATEWAY_URL"] ?? "http://localhost:18789";
      const response = await fetch(`${gatewayUrl}/api/sessions`);
      if (!response.ok) {
        return { error: `Failed to fetch sessions: ${response.status}`, sessions: [] };
      }
      const data = await response.json() as { sessions: unknown[] };
      return data;
    } catch (error) {
      return { error: String(error), sessions: [] };
    }
  },
};

// ─── Sessions History ───────────────────────────────────────────────────────

const SessionsHistoryInputSchema = z.object({
  sessionId: z.string().min(1).describe("Target session ID to read history from"),
  limit: z.number().int().min(1).max(100).optional().describe("Max messages to return. Default: 20"),
});

export const sessionsHistoryTool: ToolDefinitionRuntime = {
  name: "sessions_history",
  description:
    "Read conversation history from another session. " +
    "Use sessions_list first to discover available sessions. " +
    "Returns the most recent messages from the target session.",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Target session ID" },
      limit: { type: "integer", description: "Max messages (1-100)", minimum: 1, maximum: 100 },
    },
    required: ["sessionId"],
  },
  inputSchema: SessionsHistoryInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["sessions", "multi-agent"],

  async execute(input: Record<string, unknown>, _context: ToolExecutionContext): Promise<unknown> {
    const params = SessionsHistoryInputSchema.parse(input);
    logger.debug({ targetSessionId: params.sessionId, limit: params.limit }, "Reading session history");

    try {
      const gatewayUrl = process.env["GATEWAY_URL"] ?? "http://localhost:18789";
      const response = await fetch(`${gatewayUrl}/api/sessions/${encodeURIComponent(params.sessionId)}/history?limit=${params.limit ?? 20}`);
      if (!response.ok) {
        return { sessionId: params.sessionId, error: `HTTP ${response.status}`, messages: [] };
      }
      const data = await response.json() as { messages: unknown[] };
      return { sessionId: params.sessionId, ...data };
    } catch (error) {
      return { sessionId: params.sessionId, error: String(error), messages: [] };
    }
  },
};

// ─── Sessions Send ──────────────────────────────────────────────────────────

const SessionsSendInputSchema = z.object({
  sessionId: z.string().min(1).describe("Target session ID to send message to"),
  message: z.string().min(1).describe("Message content to send"),
  replyBack: z.boolean().optional().describe("If true, request a reply from the target agent. Default: false"),
});

export const sessionsSendTool: ToolDefinitionRuntime = {
  name: "sessions_send",
  description:
    "Send a message to another active session. " +
    "The message will be injected as a system message into the target session. " +
    "Use replyBack=true to request the target agent respond.",
  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Target session ID" },
      message: { type: "string", description: "Message content" },
      replyBack: { type: "boolean", description: "Request reply from target" },
    },
    required: ["sessionId", "message"],
  },
  inputSchema: SessionsSendInputSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: 10_000,
  tags: ["sessions", "multi-agent", "communication"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    const params = SessionsSendInputSchema.parse(input);
    logger.info(
      { from: context.sessionId, to: params.sessionId, replyBack: params.replyBack },
      "Sending inter-agent message",
    );

    try {
      const gatewayUrl = process.env["GATEWAY_URL"] ?? "http://localhost:18789";
      const response = await fetch(`${gatewayUrl}/api/sessions/${encodeURIComponent(params.sessionId)}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `[Inter-agent message from session ${context.sessionId}]: ${params.message}`,
          role: "system",
          replyBack: params.replyBack ?? false,
        }),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      return {
        success: true,
        targetSessionId: params.sessionId,
        delivered: true,
        replyBack: params.replyBack ?? false,
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
};
