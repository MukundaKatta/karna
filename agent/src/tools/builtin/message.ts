// ─── Cross-Channel Message Tool ─────────────────────────────────────────────
// Send messages across any connected channel from within an agent turn.
// Like OpenClaw's `message` tool.

import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-message" });

const MessageInputSchema = z.object({
  channelId: z.string().min(1).describe("Target channel ID or session ID"),
  content: z.string().min(1).describe("Message content to send"),
  channelType: z.string().optional().describe("Channel type (telegram, discord, slack, etc.). Auto-detected if omitted."),
  replyToMessageId: z.string().optional().describe("Message ID to reply to (thread support)"),
});

export const messageTool: ToolDefinitionRuntime = {
  name: "message",
  description:
    "Send a message to any connected channel or session. " +
    "Use to proactively notify users, send results to other channels, " +
    "or reply in specific threads.",
  parameters: {
    type: "object",
    properties: {
      channelId: { type: "string", description: "Target channel or session ID" },
      content: { type: "string", description: "Message content" },
      channelType: { type: "string", description: "Channel type (auto-detected if omitted)" },
      replyToMessageId: { type: "string", description: "Reply to a specific message" },
    },
    required: ["channelId", "content"],
  },
  inputSchema: MessageInputSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: 10_000,
  tags: ["messaging", "channels"],

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<unknown> {
    const params = MessageInputSchema.parse(input);
    logger.info(
      { channelId: params.channelId, channelType: params.channelType, fromSession: context.sessionId },
      "Sending cross-channel message",
    );

    try {
      const gatewayUrl = process.env["GATEWAY_URL"] ?? "http://localhost:18789";
      const response = await fetch(`${gatewayUrl}/api/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: params.channelId,
          content: params.content,
          channelType: params.channelType,
          replyToMessageId: params.replyToMessageId,
          fromSessionId: context.sessionId,
        }),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${await response.text()}` };
      }

      return { success: true, channelId: params.channelId, delivered: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
};
