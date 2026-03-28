import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  type Message,
  type TextChannel,
  type DMChannel,
  type Interaction,
  ChannelType,
} from "discord.js";
import WebSocket from "ws";
import pino from "pino";
import { randomUUID } from "node:crypto";
import type {
  ProtocolMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  StatusMessage,
  ErrorMessage,
} from "@karna/shared";
import { registerSlashCommands, handleSlashCommand } from "./slash-commands.js";

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

// ─── DiscordAdapter ─────────────────────────────────────────────────────────

export class DiscordAdapter {
  private readonly client: Client;
  private readonly config: DiscordAdapterConfig;
  private readonly logger: pino.Logger;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessionMap = new Map<string, string>(); // channelId -> sessionId
  private pendingResponses = new Map<string, PendingResponse>();
  private isShuttingDown = false;

  constructor(config: DiscordAdapterConfig) {
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
    await this.connectToGateway();

    this.client.once("ready", async () => {
      this.logger.info(
        { username: this.client.user?.tag },
        "Discord bot ready",
      );

      await registerSlashCommands(
        this.config.botToken,
        this.config.clientId,
        this.logger,
      );
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

    this.client.destroy();
    this.logger.info("Discord adapter stopped");
  }

  // ─── Event Handlers ───────────────────────────────────────────────────

  private setupEventHandlers(): void {
    this.client.on("messageCreate", async (message: Message) => {
      await this.handleMessage(message);
    });

    this.client.on("interactionCreate", async (interaction: Interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await handleSlashCommand(interaction, this, this.logger);
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
      attachments.length > 0 ? attachments : undefined,
    );
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  async forwardToGateway(
    channelId: string,
    content: string,
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
        payload: {
          channelType: "discord",
          channelId,
          metadata: { channelId },
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    }

    const payload: Record<string, unknown> = {
      content,
      role: "user" as const,
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

    await this.sendDiscordMessage(channelId, content);
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

      await this.sendDiscordMessage(channelId, fullContent);
    }
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

  async sendDiscordMessage(channelId: string, content: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased() || !("send" in channel)) {
        this.logger.warn({ channelId }, "Channel not text-based or not sendable");
        return;
      }

      const sendableChannel = channel as TextChannel | DMChannel;
      const chunks = splitMessage(content, DISCORD_MAX_MESSAGE_LENGTH);

      for (const chunk of chunks) {
        // If the message contains code blocks or is short, send as plain text
        // For longer structured responses, use an embed
        if (chunk.length > 1000 && !chunk.includes("```")) {
          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setDescription(chunk);

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
