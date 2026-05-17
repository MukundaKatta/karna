import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  type Message,
  type TextChannel,
  type DMChannel,
  type Interaction,
  type ButtonInteraction,
  ChannelType,
} from "discord.js";
import WebSocket from "ws";
import pino from "pino";
import { randomUUID } from "node:crypto";
import { PersistentSessionMap } from "@karna/shared";
import type {
  ProtocolMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  StatusMessage,
  ErrorMessage,
  ToolApprovalRequestedMessage,
  ToolResultMessage,
} from "@karna/shared";
import {
  registerSlashCommands,
  handleSlashCommand,
  handleSkillSelectInteraction,
} from "./slash-commands.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DiscordAdapterConfig {
  botToken: string;
  clientId: string;
  gatewayUrl: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

interface PendingResponse {
  channelId: string;
  chunks: string[];
  streamComplete: boolean;
}

const DISCORD_MAX_MESSAGE_LENGTH = 2000;
const DISCORD_MAX_EMBED_DESCRIPTION_LENGTH = 3900;
const DISCORD_COLOR_INFO = 0x5865f2;
const DISCORD_COLOR_SUCCESS = 0x2ecc71;
const DISCORD_COLOR_ERROR = 0xe74c3c;
const TOOL_APPROVAL_CUSTOM_ID_PREFIX = "karna:tool-approval";

interface PendingToolApproval {
  sessionId: string;
  toolCallId: string;
}

// ─── DiscordAdapter ─────────────────────────────────────────────────────────

export class DiscordAdapter {
  private readonly client: Client;
  private readonly config: DiscordAdapterConfig;
  private readonly logger: pino.Logger;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly sessionMap: PersistentSessionMap<string, string>;
  private pendingResponses = new Map<string, PendingResponse>();
  private pendingToolApprovals = new Map<string, PendingToolApproval>();
  private isShuttingDown = false;
  private slashCommandRegistration: Promise<void> | null = null;

  constructor(config: DiscordAdapterConfig) {
    if (!config.botToken || config.botToken.length < 50) {
      throw new Error("Invalid Discord bot token format");
    }

    this.config = {
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:discord",
      level: process.env["LOG_LEVEL"] ?? "info",
    });

    this.sessionMap = new PersistentSessionMap<string, string>({
      name: "discord",
      logger: this.logger,
    });

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting Discord adapter");

    this.setupEventHandlers();
    await this.sessionMap.load();
    await this.connectToGateway();
    await this.ensureSlashCommandsRegistered();

    this.client.once("ready", async () => {
      this.logger.info(
        { username: this.client.user?.tag },
        "Discord bot ready",
      );

      await this.ensureSlashCommandsRegistered();
    });

    await this.client.login(this.config.botToken);
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping Discord adapter");

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Adapter shutting down");
      this.ws = null;
    }

    await this.sessionMap.flush();
    this.client.destroy();
    this.logger.info("Discord adapter stopped");
  }

  // ─── Event Handlers ───────────────────────────────────────────────────

  private setupEventHandlers(): void {
    this.client.on("messageCreate", async (message: Message) => {
      await this.handleMessage(message);
    });

    this.client.on("interactionCreate", async (interaction: Interaction) => {
      if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction, this, this.logger);
        return;
      }

      if (interaction.isButton()) {
        await this.handleToolApprovalButton(interaction);
        return;
      }

      if (interaction.isStringSelectMenu()) {
        await handleSkillSelectInteraction(interaction);
      }
    });
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    const isDM = message.channel.type === ChannelType.DM;
    const isMentioned = message.mentions.has(this.client.user!);

    // Only respond to DMs or mentions
    if (!isDM && !isMentioned) return;

    let content = message.content;

    // Remove bot mention from content
    if (isMentioned && this.client.user) {
      content = content.replace(`<@${this.client.user.id}>`, "").trim();
      content = content.replace(`<@!${this.client.user.id}>`, "").trim();
    }

    if (!content && message.attachments.size === 0) return;

    this.logger.debug(
      { channelId: message.channelId, isDM, contentLength: content.length },
      "Received message",
    );

    // Process attachments
    const attachments: Array<{ type: string; url?: string; name?: string }> = [];
    for (const [, attachment] of message.attachments) {
      const type = attachment.contentType?.startsWith("image/")
        ? "image"
        : attachment.contentType?.startsWith("video/")
          ? "video"
          : attachment.contentType?.startsWith("audio/")
            ? "audio"
            : "document";

      attachments.push({
        type,
        url: attachment.url,
        name: attachment.name ?? undefined,
      });
    }

    if (!content && attachments.length > 0) {
      content = "User sent an attachment.";
    }

    await this.forwardToGateway(
      message.channelId,
      content,
      {
        userId: message.author.id,
        isDirectMessage: isDM,
        agentMentioned: isMentioned,
      },
      attachments.length > 0 ? attachments : undefined,
    );
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  async forwardToGateway(
    channelId: string,
    content: string,
    routing: { userId: string; isDirectMessage: boolean; agentMentioned: boolean },
    attachments?: Array<{ type: string; url?: string; data?: string; name?: string }>,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn({ channelId }, "Gateway not connected, cannot forward message");
      try {
        const channel = await this.client.channels.fetch(channelId);
        if (channel?.isTextBased() && "send" in channel) {
          await (channel as TextChannel | DMChannel).send(
            "I'm currently reconnecting to my backend. Please try again in a moment.",
          );
        }
      } catch {
        // Swallow send errors during reconnection
      }
      return;
    }

    let sessionId = this.sessionMap.get(channelId);

    if (!sessionId) {
      sessionId = randomUUID();
      this.sessionMap.set(channelId, sessionId);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId,
        payload: {
          channelType: "discord",
          channelId,
          metadata: {
            channelId,
            userId: routing.userId,
            isDirectMessage: routing.isDirectMessage,
          },
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    }

    const payload: Record<string, unknown> = {
      content,
      role: "user" as const,
      metadata: {
        senderUserId: routing.userId,
        isDirectMessage: routing.isDirectMessage,
        agentMentioned: routing.agentMentioned,
      },
    };
    if (attachments && attachments.length > 0) {
      payload["attachments"] = attachments;
    }

    const chatMessage = {
      id: randomUUID(),
      type: "chat.message" as const,
      timestamp: Date.now(),
      sessionId,
      payload,
    };

    this.ws.send(JSON.stringify(chatMessage));
    this.logger.debug({ channelId, sessionId }, "Forwarded message to gateway");
  }

  private async connectToGateway(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wsUrl = this.config.gatewayUrl.replace(/^http/, "ws");

      this.logger.info({ url: wsUrl }, "Connecting to gateway");

      this.ws = new WebSocket(wsUrl);

      this.ws.on("open", () => {
        this.logger.info("Connected to gateway");
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.reregisterSessions();
        resolve();
      });

      this.ws.on("message", (data: WebSocket.RawData) => {
        this.handleGatewayMessage(data);
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        this.logger.warn(
          { code, reason: reason.toString() },
          "Gateway connection closed",
        );
        this.stopHeartbeat();

        if (!this.isShuttingDown) {
          this.scheduleReconnect();
        }
      });

      this.ws.on("error", (error: Error) => {
        this.logger.error({ error: error.message }, "Gateway WebSocket error");

        if (this.reconnectAttempts === 0) {
          reject(new Error(`Failed to connect to gateway: ${error.message}`));
        }
      });
    });
  }

  private ensureSlashCommandsRegistered(): Promise<void> {
    if (!this.slashCommandRegistration) {
      this.slashCommandRegistration = registerSlashCommands(
        this.config.botToken,
        this.config.clientId,
        this.logger,
      );
    }

    return this.slashCommandRegistration;
  }

  private handleGatewayMessage(data: WebSocket.RawData): void {
    let message: ProtocolMessage;
    try {
      message = JSON.parse(data.toString()) as ProtocolMessage;
    } catch {
      this.logger.error("Failed to parse gateway message");
      return;
    }

    switch (message.type) {
      case "connect.ack":
        this.handleConnectAck(message);
        break;
      case "agent.response":
        void this.handleAgentResponse(message as AgentResponseMessage);
        break;
      case "agent.response.stream":
        void this.handleAgentStreamResponse(message as AgentResponseStreamMessage);
        break;
      case "tool.result":
        void this.handleToolResult(message as ToolResultMessage);
        break;
      case "tool.approval.requested":
        void this.handleToolApprovalRequest(message as ToolApprovalRequestedMessage);
        break;
      case "status":
        void this.handleStatusUpdate(message as StatusMessage);
        break;
      case "heartbeat.check":
        this.handleHeartbeatCheck(message);
        break;
      case "error":
        void this.handleError(message as ErrorMessage);
        break;
      default:
        this.logger.debug({ type: message.type }, "Unhandled gateway message type");
    }
  }

  private handleConnectAck(message: ProtocolMessage): void {
    if (message.type !== "connect.ack") return;
    const { sessionId } = message.payload;
    this.logger.info({ sessionId }, "Session acknowledged by gateway");
  }

  private async handleAgentResponse(message: AgentResponseMessage): Promise<void> {
    const channelId = this.findChannelIdBySession(message.sessionId);
    if (!channelId) {
      this.logger.warn({ sessionId: message.sessionId }, "No channel found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    await this.sendDiscordMessage(channelId, content, {
      finishReason: message.payload.finishReason,
    });
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const channelId = this.findChannelIdBySession(sessionId);
    if (!channelId) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = { channelId, chunks: [], streamComplete: false };
      this.pendingResponses.set(sessionId, pending);
    }

    pending.chunks.push(message.payload.delta);

    if (message.payload.finishReason) {
      pending.streamComplete = true;
      const fullContent = pending.chunks.join("");
      this.pendingResponses.delete(sessionId);

      await this.sendDiscordMessage(channelId, fullContent, {
        finishReason: message.payload.finishReason,
      });
    }
  }

  private async handleToolResult(message: ToolResultMessage): Promise<void> {
    const channelId = this.findChannelIdBySession(message.sessionId);
    if (!channelId) return;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased() || !("send" in channel)) return;

      const embed = buildDiscordToolResultEmbed(message);
      await (channel as TextChannel | DMChannel).send({ embeds: [embed] });
    } catch (error) {
      this.logger.error({ error, channelId }, "Failed to send Discord tool result");
    }
  }

  private async handleToolApprovalRequest(
    message: ToolApprovalRequestedMessage,
  ): Promise<void> {
    const channelId = this.findChannelIdBySession(message.sessionId);
    if (!channelId || !message.sessionId) return;

    const requestId = randomUUID();
    this.pendingToolApprovals.set(requestId, {
      sessionId: message.sessionId,
      toolCallId: message.payload.toolCallId,
    });

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased() || !("send" in channel)) return;

      const embed = buildDiscordToolApprovalEmbed(message);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${TOOL_APPROVAL_CUSTOM_ID_PREFIX}:approve:${requestId}`)
          .setLabel("Approve")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${TOOL_APPROVAL_CUSTOM_ID_PREFIX}:deny:${requestId}`)
          .setLabel("Deny")
          .setStyle(ButtonStyle.Danger),
      );

      await (channel as TextChannel | DMChannel).send({
        embeds: [embed],
        components: [row],
      });
    } catch (error) {
      this.pendingToolApprovals.delete(requestId);
      this.logger.error({ error, channelId }, "Failed to send Discord approval request");
    }
  }

  private async handleToolApprovalButton(
    interaction: ButtonInteraction,
  ): Promise<void> {
    if (!interaction.customId.startsWith(TOOL_APPROVAL_CUSTOM_ID_PREFIX)) {
      return;
    }

    const [, , decision, requestId] = interaction.customId.split(":");
    const approval = requestId ? this.pendingToolApprovals.get(requestId) : undefined;

    if (!approval || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await interaction.reply({
        content: "This approval request is no longer active.",
        ephemeral: true,
      });
      return;
    }

    this.pendingToolApprovals.delete(requestId);

    const approved = decision === "approve";
    const approvalResponse: ProtocolMessage = {
      id: randomUUID(),
      type: "tool.approval.response",
      timestamp: Date.now(),
      sessionId: approval.sessionId,
      payload: {
        toolCallId: approval.toolCallId,
        approved,
        reason: approved ? "Approved from Discord" : "Denied from Discord",
      },
    };

    this.ws.send(JSON.stringify(approvalResponse));

    await interaction.update({
      content: approved ? "Tool approved." : "Tool denied.",
      components: [],
    });
  }

  private async handleStatusUpdate(message: StatusMessage): Promise<void> {
    const channelId = this.findChannelIdBySession(message.sessionId);
    if (!channelId) return;

    const { state } = message.payload;

    if (state === "thinking") {
      try {
        const channel = await this.client.channels.fetch(channelId);
        if (channel?.isTextBased() && "sendTyping" in channel) {
          await (channel as TextChannel | DMChannel).sendTyping();
        }
      } catch {
        // Ignore typing indicator errors
      }
    }
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const channelId = this.findChannelIdBySession(message.sessionId);
    if (!channelId) return;

    const { code, message: errorMsg } = message.payload;
    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isTextBased() && "send" in channel) {
        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("Error")
          .setDescription(errorMsg)
          .setFooter({ text: `Error code: ${code}` });

        await (channel as TextChannel | DMChannel).send({ embeds: [embed] });
      }
    } catch (error) {
      this.logger.error({ error, channelId }, "Failed to send error message");
    }
  }

  private handleHeartbeatCheck(message: ProtocolMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const ack: ProtocolMessage = {
      id: randomUUID(),
      type: "heartbeat.ack",
      timestamp: Date.now(),
      sessionId: message.sessionId,
      payload: { clientTime: Date.now() },
    };

    this.ws.send(JSON.stringify(ack));
  }

  // ─── Discord Messaging ───────────────────────────────────────────────

  async sendDiscordMessage(
    channelId: string,
    content: string,
    options: { finishReason?: AgentResponseMessage["payload"]["finishReason"] } = {},
  ): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased() || !("send" in channel)) {
        this.logger.warn({ channelId }, "Channel not text-based or not sendable");
        return;
      }

      const sendableChannel = channel as TextChannel | DMChannel;
      const normalizedContent = normalizeDiscordCodeBlocks(content);
      const chunks = splitMessage(normalizedContent, DISCORD_MAX_MESSAGE_LENGTH);

      for (const chunk of chunks) {
        if (shouldSendAsEmbed(chunk, options.finishReason)) {
          const embed = buildDiscordResponseEmbed(chunk, options.finishReason);
          await sendableChannel.send({ embeds: [embed] });
        } else {
          await sendableChannel.send(chunk);
        }
      }
    } catch (error) {
      this.logger.error({ error, channelId }, "Failed to send Discord message");
    }
  }

  // ─── Reconnection ─────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts ?? 20)) {
      this.logger.error("Max reconnect attempts reached, giving up");
      return;
    }

    const delay = Math.min(
      (this.config.reconnectIntervalMs ?? 5_000) * Math.pow(2, this.reconnectAttempts),
      60_000,
    );

    this.reconnectAttempts++;
    this.logger.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      "Scheduling gateway reconnect",
    );

    this.reconnectTimer = setTimeout(() => {
      void this.connectToGateway().catch((error) => {
        this.logger.error({ error }, "Reconnect failed");
        this.scheduleReconnect();
      });
    }, delay);
  }

  // ─── Heartbeat ────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.config.heartbeatIntervalMs ?? 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private reregisterSessions(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const [channelId, sessionId] of this.sessionMap.entries()) {
      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId,
        payload: {
          channelType: "discord",
          channelId,
          metadata: { channelId },
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    }

    if (this.sessionMap.size > 0) {
      this.logger.info({ sessionCount: this.sessionMap.size }, "Re-registered Discord sessions");
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private findChannelIdBySession(sessionId: string | undefined): string | null {
    if (!sessionId) return null;

    for (const [channelId, sid] of this.sessionMap.entries()) {
      if (sid === sessionId) return channelId;
    }

    return null;
  }

  resetSession(channelId: string): void {
    this.sessionMap.delete(channelId);
    this.logger.info({ channelId }, "Session reset");
  }

  getSessionId(channelId: string): string | undefined {
    return this.sessionMap.get(channelId);
  }
}

// ─── Message Splitting ──────────────────────────────────────────────────────

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at natural boundaries
    let splitIndex = remaining.lastIndexOf("\n\n", maxLen);
    if (splitIndex <= maxLen * 0.3) {
      splitIndex = remaining.lastIndexOf("\n", maxLen);
    }
    if (splitIndex <= maxLen * 0.3) {
      splitIndex = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIndex <= 0) {
      splitIndex = maxLen;
    }

    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function shouldSendAsEmbed(
  content: string,
  finishReason?: AgentResponseMessage["payload"]["finishReason"],
): boolean {
  return finishReason === "error" || (!content.includes("```") && content.length > 600);
}

export function buildDiscordResponseEmbed(
  content: string,
  finishReason: AgentResponseMessage["payload"]["finishReason"] = "stop",
): EmbedBuilder {
  const isError = finishReason === "error";
  const isToolUse = finishReason === "tool_use";
  const hasMemoryRecall = hasMemoryRecallSignal(content);

  const embed = new EmbedBuilder()
    .setColor(
      isError
        ? DISCORD_COLOR_ERROR
        : isToolUse
          ? DISCORD_COLOR_INFO
          : DISCORD_COLOR_SUCCESS,
    )
    .setDescription(content.slice(0, DISCORD_MAX_EMBED_DESCRIPTION_LENGTH))
    .setTimestamp();

  if (isError) {
    embed.setTitle("Agent Error");
  } else if (isToolUse) {
    embed.setTitle("Tool Request");
  }

  if (hasMemoryRecall) {
    embed.setFooter({ text: "Memory context included" });
  }

  return embed;
}

export function buildDiscordToolResultEmbed(
  message: ToolResultMessage,
): EmbedBuilder {
  const result = formatToolResult(message.payload.result);
  const embed = new EmbedBuilder()
    .setColor(message.payload.isError ? DISCORD_COLOR_ERROR : DISCORD_COLOR_SUCCESS)
    .setTitle(message.payload.isError ? "Tool Error" : "Tool Result")
    .addFields(
      { name: "Tool", value: `\`${message.payload.toolName}\``, inline: true },
      {
        name: "Status",
        value: message.payload.isError ? "Error" : "Success",
        inline: true,
      },
    )
    .setTimestamp();

  if (message.payload.durationMs !== undefined) {
    embed.addFields({
      name: "Duration",
      value: `${message.payload.durationMs}ms`,
      inline: true,
    });
  }

  embed.addFields({
    name: "Result",
    value: result.slice(0, 1024) || "(empty)",
  });

  return embed;
}

export function buildDiscordToolApprovalEmbed(
  message: ToolApprovalRequestedMessage,
): EmbedBuilder {
  const { toolName, description, riskLevel } = message.payload;

  return new EmbedBuilder()
    .setColor(
      riskLevel === "critical" || riskLevel === "high"
        ? DISCORD_COLOR_ERROR
        : DISCORD_COLOR_INFO,
    )
    .setTitle("Tool Approval Required")
    .addFields(
      { name: "Tool", value: `\`${toolName}\``, inline: true },
      { name: "Risk", value: riskLevel, inline: true },
      {
        name: "Description",
        value: description ?? "No description provided.",
      },
    )
    .setTimestamp();
}

function normalizeDiscordCodeBlocks(content: string): string {
  return content.replace(/```\n/g, "```text\n");
}

function hasMemoryRecallSignal(content: string): boolean {
  return /\b(memory|remember|remembered|recall|recalled)\b/i.test(content);
}

function formatToolResult(result: unknown): string {
  if (typeof result === "string") return result;

  try {
    return `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
  } catch {
    return String(result);
  }
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const botToken = process.env["DISCORD_BOT_TOKEN"];
  const clientId = process.env["DISCORD_CLIENT_ID"];
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";

  if (!botToken) {
    process.stderr.write("DISCORD_BOT_TOKEN environment variable is required" + "\n");
    process.exit(1);
  }

  if (!clientId) {
    process.stderr.write("DISCORD_CLIENT_ID environment variable is required" + "\n");
    process.exit(1);
  }

  const adapter = new DiscordAdapter({ botToken, clientId, gatewayUrl });

  const shutdown = async () => {
    await adapter.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await adapter.start();
}

const isMainModule =
  typeof import.meta.url === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main().catch((error) => {
    process.stderr.write(`Fatal error: ${String(error)}\n`);
    process.exit(1);
  });
}
