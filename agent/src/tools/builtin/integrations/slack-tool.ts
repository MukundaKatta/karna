// ─── Slack Integration Tools ──────────────────────────────────────────────
//
// Uses the Slack Web API via fetch. Requires SLACK_BOT_TOKEN env var.
// Token needs scopes: chat:write, channels:read, search:read, users:write

import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../../registry.js";

const logger = pino({ name: "tool-slack" });
const TIMEOUT_MS = 15_000;
const SLACK_API = "https://slack.com/api";

// ─── Helpers ──────────────────────────────────────────────────────────────

function getToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error(
      "SLACK_BOT_TOKEN is not set. Create a Slack app at https://api.slack.com/apps and set the bot token."
    );
  }
  return token;
}

async function slackApi(
  method: string,
  body: Record<string, unknown>
): Promise<{ output: string; isError: boolean; durationMs?: number }> {
  try {
    const token = getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = (await res.json()) as Record<string, unknown>;
    if (!data.ok) {
      return { output: `Slack API error: ${(data.error as string) ?? "unknown"}`, isError: true, durationMs: 0 };
    }
    return { output: JSON.stringify(data, null, 2), isError: false, durationMs: 0 };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { output: `Slack API timed out after ${TIMEOUT_MS}ms`, isError: true, durationMs: 0 };
    }
    logger.error({ err }, "Slack API call failed");
    return { output: `Slack API failed: ${err.message}`, isError: true, durationMs: 0 };
  }
}

// ─── slack_send_message ───────────────────────────────────────────────────

const SendMessageSchema = z.object({
  channel: z.string().min(1).describe("Channel ID or name (e.g. #general or C01234567)"),
  text: z.string().min(1).describe("Message text (supports Slack mrkdwn)"),
  thread_ts: z.string().optional().describe("Thread timestamp to reply in a thread"),
});

export const slackSendMessageTool: ToolDefinitionRuntime = {
  name: "slack_send_message",
  description: "Send a message to a Slack channel or thread. Requires SLACK_BOT_TOKEN.",
  parameters: {
    type: "object",
    properties: {
      channel: { type: "string", description: "Channel ID or name" },
      text: { type: "string", description: "Message text (Slack mrkdwn)" },
      thread_ts: { type: "string", description: "Thread timestamp for replies" },
    },
    required: ["channel", "text"],
  },
  inputSchema: SendMessageSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: TIMEOUT_MS,
  tags: ["integration", "slack"],

  async execute(input) {
    const p = SendMessageSchema.parse(input);
    const body: Record<string, unknown> = { channel: p.channel, text: p.text };
    if (p.thread_ts) body.thread_ts = p.thread_ts;
    return slackApi("chat.postMessage", body);
  },
};

// ─── slack_list_channels ──────────────────────────────────────────────────

const ListChannelsSchema = z.object({
  limit: z.number().int().min(1).max(200).optional().describe("Max channels (default 100)"),
  types: z
    .string()
    .optional()
    .describe("Comma-separated types: public_channel, private_channel, mpim, im"),
  exclude_archived: z.boolean().optional().describe("Exclude archived channels (default true)"),
});

export const slackListChannelsTool: ToolDefinitionRuntime = {
  name: "slack_list_channels",
  description:
    "List Slack channels the bot has access to. Returns channel ID, name, topic, and member count.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "Max channels (default 100)", maximum: 200 },
      types: { type: "string", description: "Channel types filter" },
      exclude_archived: { type: "boolean", description: "Exclude archived (default true)" },
    },
  },
  inputSchema: ListChannelsSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: TIMEOUT_MS,
  tags: ["integration", "slack"],

  async execute(input) {
    const p = ListChannelsSchema.parse(input);
    const body: Record<string, unknown> = {
      limit: p.limit ?? 100,
      exclude_archived: p.exclude_archived ?? true,
    };
    if (p.types) body.types = p.types;

    const result = await slackApi("conversations.list", body);
    if (result.isError) return result;

    // Slim down the response
    try {
      const data = JSON.parse(result.output);
      const channels = (data.channels ?? []).map((ch: any) => ({
        id: ch.id,
        name: ch.name,
        topic: ch.topic?.value || "",
        purpose: ch.purpose?.value || "",
        num_members: ch.num_members,
        is_archived: ch.is_archived,
      }));
      return { output: JSON.stringify(channels, null, 2), isError: false, durationMs: 0 };
    } catch {
      return result;
    }
  },
};

// ─── slack_search_messages ────────────────────────────────────────────────

const SearchMessagesSchema = z.object({
  query: z.string().min(1).describe("Search query (supports Slack search operators)"),
  count: z.number().int().min(1).max(100).optional().describe("Results per page (default 20)"),
  sort: z.enum(["score", "timestamp"]).optional().describe("Sort order (default score)"),
});

export const slackSearchMessagesTool: ToolDefinitionRuntime = {
  name: "slack_search_messages",
  description:
    "Search Slack messages by keyword. Supports Slack search operators like from:, in:, has:, before:, after:.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      count: { type: "integer", description: "Results per page (default 20)", maximum: 100 },
      sort: { type: "string", enum: ["score", "timestamp"], description: "Sort order" },
    },
    required: ["query"],
  },
  inputSchema: SearchMessagesSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: TIMEOUT_MS,
  tags: ["integration", "slack"],

  async execute(input) {
    const p = SearchMessagesSchema.parse(input);
    // search.messages uses GET params via the Web API, but the token-auth fetch works
    const body: Record<string, unknown> = {
      query: p.query,
      count: p.count ?? 20,
    };
    if (p.sort) body.sort = p.sort;
    return slackApi("search.messages", body);
  },
};

// ─── slack_set_status ─────────────────────────────────────────────────────

const SetStatusSchema = z.object({
  text: z.string().describe("Status text (empty string to clear)"),
  emoji: z.string().optional().describe("Status emoji (e.g. :house_with_garden:)"),
  expiration: z
    .number()
    .int()
    .optional()
    .describe("Unix timestamp when the status should expire (0 for no expiration)"),
});

export const slackSetStatusTool: ToolDefinitionRuntime = {
  name: "slack_set_status",
  description: "Set your Slack status text and emoji. Send empty text to clear.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Status text" },
      emoji: { type: "string", description: "Status emoji (e.g. :house_with_garden:)" },
      expiration: { type: "integer", description: "Expiration unix timestamp" },
    },
    required: ["text"],
  },
  inputSchema: SetStatusSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: TIMEOUT_MS,
  tags: ["integration", "slack"],

  async execute(input) {
    const p = SetStatusSchema.parse(input);
    return slackApi("users.profile.set", {
      profile: {
        status_text: p.text,
        status_emoji: p.emoji ?? "",
        status_expiration: p.expiration ?? 0,
      },
    });
  },
};

// ─── Collected exports ────────────────────────────────────────────────────

export const slackTools: ToolDefinitionRuntime[] = [
  slackSendMessageTool,
  slackListChannelsTool,
  slackSearchMessagesTool,
  slackSetStatusTool,
];
