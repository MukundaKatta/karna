import { Bot, type Context, GrammyError, HttpError } from "grammy";
import WebSocket from "ws";
import pino from "pino";
import { randomUUID } from "node:crypto";
import { PersistentSessionMap } from "@karna/shared";
import type {
  ProtocolMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  ToolApprovalRequestedMessage,
  StatusMessage,
  ErrorMessage,
} from "@karna/shared";
import { registerCommands } from "./commands.js";
import { formatForTelegram, splitLongMessage } from "./formatter.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TelegramAdapterConfig {
  botToken: string;
  gatewayUrl: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

interface PendingResponse {
  chatId: number;
  chunks: string[];
  streamComplete: boolean;
}

// ─── TelegramAdapter ────────────────────────────────────────────────────────

export class TelegramAdapter {
  private readonly bot: Bot;
  private readonly config: TelegramAdapterConfig;
  private readonly logger: pino.Logger;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly sessionMap: PersistentSessionMap<number, string>;
  private pendingResponses = new Map<string, PendingResponse>(); // sessionId -> pending
  private isShuttingDown = false;

  constructor(config: TelegramAdapterConfig) {
    this.config = {
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:telegram",
      level: process.env["LOG_LEVEL"] ?? "info",
    });

    this.sessionMap = new PersistentSessionMap<number, string>({
      name: "telegram",
      logger: this.logger,
      serializeKey: (chatId) => String(chatId),
      deserializeKey: (chatId) => Number(chatId),
    });

    this.bot = new Bot(config.botToken);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting Telegram adapter");

    this.setupBotHandlers();
    registerCommands(this.bot, this.logger);

    await this.sessionMap.load();
    await this.connectToGateway();
    await this.bot.start({
      onStart: (info) => {
        this.logger.info({ username: info.username }, "Telegram bot started");
      },
    });
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping Telegram adapter");

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
    await this.bot.stop();
    this.logger.info("Telegram adapter stopped");
  }

  // ─── Bot Handlers ──────────────────────────────────────────────────────

  private setupBotHandlers(): void {
    this.bot.on("message:text", async (ctx) => {
      await this.handleTextMessage(ctx);
    });

    this.bot.on("message:photo", async (ctx) => {
      await this.handlePhotoMessage(ctx);
    });

    this.bot.on("message:document", async (ctx) => {
      await this.handleDocumentMessage(ctx);
    });

    this.bot.on("message:voice", async (ctx) => {
      await this.handleVoiceMessage(ctx);
    });

    this.bot.catch((err) => {
      const ctx = err.ctx;
      const e = err.error;

      this.logger.error({ chatId: ctx.chat?.id }, "Bot error occurred");

      if (e instanceof GrammyError) {
        this.logger.error({ description: e.description }, "Grammy API error");
      } else if (e instanceof HttpError) {
        this.logger.error({ error: e.message }, "HTTP error contacting Telegram");
      } else {
        this.logger.error({ error: String(e) }, "Unknown bot error");
      }
    });
  }

  private async handleTextMessage(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text;

    if (!chatId || !text) return;

    // Skip commands — handled by grammy command handlers
    if (text.startsWith("/")) return;

    this.logger.debug({ chatId, textLength: text.length }, "Received text message");

    await this.forwardToGateway(chatId, text, undefined, this.buildRoutingMetadata(ctx));
  }

  private async handlePhotoMessage(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) return;

    // Get the highest resolution photo
    const photo = photos[photos.length - 1];
    if (!photo) return;

    try {
      const file = await ctx.api.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;
      const caption = ctx.message?.caption ?? "User sent a photo.";

      this.logger.debug({ chatId, fileId: photo.file_id }, "Received photo message");

      await this.forwardToGateway(
        chatId,
        caption,
        [{ type: "image", url: fileUrl, name: file.file_path }],
        this.buildRoutingMetadata(ctx),
      );
    } catch (error) {
      this.logger.error({ error, chatId }, "Failed to process photo");
      await ctx.reply("Sorry, I could not process that photo. Please try again.");
    }
  }

  private async handleDocumentMessage(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    const doc = ctx.message?.document;
    if (!chatId || !doc) return;

    try {
      const file = await ctx.api.getFile(doc.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;
      const caption = ctx.message?.caption ?? `User sent a document: ${doc.file_name ?? "unknown"}`;

      this.logger.debug({ chatId, fileName: doc.file_name }, "Received document message");

      await this.forwardToGateway(
        chatId,
        caption,
        [{ type: "document", url: fileUrl, name: doc.file_name ?? file.file_path }],
        this.buildRoutingMetadata(ctx),
      );
    } catch (error) {
      this.logger.error({ error, chatId }, "Failed to process document");
      await ctx.reply("Sorry, I could not process that document. Please try again.");
    }
  }

  private async handleVoiceMessage(ctx: Context): Promise<void> {
    const chatId = ctx.chat?.id;
    const voice = ctx.message?.voice;
    if (!chatId || !voice) return;

    try {
      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${this.config.botToken}/${file.file_path}`;

      this.logger.debug({ chatId, duration: voice.duration }, "Received voice message");

      await this.forwardToGateway(
        chatId,
        "User sent a voice message.",
        [{ type: "audio", url: fileUrl, name: file.file_path }],
        this.buildRoutingMetadata(ctx),
      );
    } catch (error) {
      this.logger.error({ error, chatId }, "Failed to process voice message");
      await ctx.reply("Sorry, I could not process that voice message. Please try again.");
    }
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private async forwardToGateway(
    chatId: number,
    content: string,
    attachments?: Array<{ type: string; url?: string; data?: string; name?: string }>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn({ chatId }, "Gateway not connected, cannot forward message");
      try {
        await this.bot.api.sendMessage(
          chatId,
          "I'm currently reconnecting to my backend. Please try again in a moment.",
        );
      } catch {
        // Swallow send errors during reconnection
      }
      return;
    }

    let sessionId = this.sessionMap.get(chatId);

    // If no session exists, send a connect message first
    if (!sessionId) {
      sessionId = randomUUID();
      this.sessionMap.set(chatId, sessionId);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId,
        payload: {
          channelType: "telegram",
          channelId: String(chatId),
          metadata: {
            chatId,
            ...metadata,
          },
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
    if (metadata) {
      payload["metadata"] = metadata;
    }

    const chatMessage = {
      id: randomUUID(),
      type: "chat.message" as const,
      timestamp: Date.now(),
      sessionId,
      payload,
    };

    this.ws.send(JSON.stringify(chatMessage));
    this.logger.debug({ chatId, sessionId }, "Forwarded message to gateway");
  }

  private buildRoutingMetadata(ctx: Context): Record<string, unknown> {
    const chatType = ctx.chat?.type ?? "private";
    const senderId = String(ctx.from?.id ?? ctx.chat?.id ?? "");
    const botId = this.bot.botInfo?.id;
    const botUsername = this.bot.botInfo?.username?.toLowerCase();
    const text = this.extractMessageText(ctx);
    const entities = this.extractMessageEntities(ctx);
    const replyFromId = ctx.message?.reply_to_message?.from?.id;

    const agentMentioned = entities.some((entity) => {
      if (entity.type === "text_mention" && botId !== undefined) {
        return entity.user?.id === botId;
      }

      if (entity.type !== "mention" || !botUsername || !text) {
        return false;
      }

      const mention = text
        .slice(entity.offset, entity.offset + entity.length)
        .trim()
        .toLowerCase();
      return mention === `@${botUsername}`;
    });

    return {
      chatId: ctx.chat?.id,
      userId: senderId,
      senderUserId: senderId,
      conversationType: chatType,
      isDirectMessage: chatType === "private",
      isGroup: chatType === "group" || chatType === "supergroup",
      isReplyToAgent: botId !== undefined && replyFromId === botId,
      agentMentioned,
    };
  }

  private extractMessageText(ctx: Context): string {
    const message = ctx.message;
    if (!message) return "";
    if ("text" in message && typeof message.text === "string") {
      return message.text;
    }
    if ("caption" in message && typeof message.caption === "string") {
      return message.caption;
    }
    return "";
  }

  private extractMessageEntities(ctx: Context): Array<{
    type: string;
    offset: number;
    length: number;
    user?: { id: number };
  }> {
    const message = ctx.message;
    if (!message) return [];

    if ("entities" in message && Array.isArray(message.entities)) {
      return message.entities;
    }

    if ("caption_entities" in message && Array.isArray(message.caption_entities)) {
      return message.caption_entities;
    }

    return [];
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

    // Update session map with the gateway-assigned session ID
    for (const [chatId, sid] of this.sessionMap.entries()) {
      if (sid === message.sessionId || !this.sessionMap.has(chatId)) {
        this.sessionMap.set(chatId, sessionId);
        break;
      }
    }
  }

  private async handleAgentResponse(message: AgentResponseMessage): Promise<void> {
    const chatId = this.findChatIdBySession(message.sessionId);
    if (!chatId) {
      this.logger.warn({ sessionId: message.sessionId }, "No chat found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    const formatted = formatForTelegram(content);
    const chunks = splitLongMessage(formatted);

    for (const chunk of chunks) {
      try {
        await this.bot.api.sendMessage(chatId, chunk, { parse_mode: "MarkdownV2" });
      } catch (error) {
        this.logger.warn({ chatId }, "MarkdownV2 send failed, retrying as plain text");
        try {
          await this.bot.api.sendMessage(chatId, content);
        } catch (plainError) {
          this.logger.error({ error: plainError, chatId }, "Failed to send message");
        }
      }
    }
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const chatId = this.findChatIdBySession(sessionId);
    if (!chatId) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = { chatId, chunks: [], streamComplete: false };
      this.pendingResponses.set(sessionId, pending);
    }

    pending.chunks.push(message.payload.delta);

    if (message.payload.finishReason) {
      pending.streamComplete = true;
      const fullContent = pending.chunks.join("");
      this.pendingResponses.delete(sessionId);

      const formatted = formatForTelegram(fullContent);
      const parts = splitLongMessage(formatted);

      for (const part of parts) {
        try {
          await this.bot.api.sendMessage(chatId, part, { parse_mode: "MarkdownV2" });
        } catch {
          try {
            await this.bot.api.sendMessage(chatId, fullContent);
          } catch (error) {
            this.logger.error({ error, chatId }, "Failed to send streamed response");
          }
        }
      }
    }
  }

  private async handleToolApprovalRequest(
    message: ToolApprovalRequestedMessage,
  ): Promise<void> {
    const chatId = this.findChatIdBySession(message.sessionId);
    if (!chatId) return;

    const { toolName, description, riskLevel, toolCallId } = message.payload;

    const text = [
      `*Tool Approval Required*`,
      ``,
      `Tool: \`${toolName}\``,
      `Risk: ${riskLevel}`,
      description ? `Description: ${description}` : "",
      ``,
      `Reply with /approve or /deny`,
    ]
      .filter(Boolean)
      .join("\n");

    const formatted = formatForTelegram(text);

    try {
      await this.bot.api.sendMessage(chatId, formatted, { parse_mode: "MarkdownV2" });
    } catch {
      await this.bot.api.sendMessage(
        chatId,
        `Tool "${toolName}" (${riskLevel} risk) requires approval. Reply /approve or /deny.`,
      );
    }

    // Auto-approve low-risk tools (configurable behavior)
    if (riskLevel === "low" && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const approvalResponse: ProtocolMessage = {
        id: randomUUID(),
        type: "tool.approval.response",
        timestamp: Date.now(),
        sessionId: message.sessionId,
        payload: {
          toolCallId,
          approved: true,
          reason: "Auto-approved (low risk)",
        },
      };
      this.ws.send(JSON.stringify(approvalResponse));
    }
  }

  private async handleStatusUpdate(message: StatusMessage): Promise<void> {
    const chatId = this.findChatIdBySession(message.sessionId);
    if (!chatId) return;

    const { state } = message.payload;

    if (state === "thinking") {
      try {
        await this.bot.api.sendChatAction(chatId, "typing");
      } catch {
        // Ignore typing indicator errors
      }
    }
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const chatId = this.findChatIdBySession(message.sessionId);
    if (!chatId) return;

    const { code, message: errorMsg } = message.payload;

    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    try {
      await this.bot.api.sendMessage(
        chatId,
        `An error occurred: ${errorMsg}\nPlease try again or use /reset to start a new session.`,
      );
    } catch (error) {
      this.logger.error({ error, chatId }, "Failed to send error message to user");
    }
  }

  private handleHeartbeatCheck(message: ProtocolMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const ack: ProtocolMessage = {
      id: randomUUID(),
      type: "heartbeat.ack",
      timestamp: Date.now(),
      sessionId: message.sessionId,
      payload: {
        clientTime: Date.now(),
      },
    };

    this.ws.send(JSON.stringify(ack));
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

  // ─── Heartbeat ─────────────────────────────────────────────────────────

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

    for (const [chatId, sessionId] of this.sessionMap.entries()) {
      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId,
        payload: {
          channelType: "telegram",
          channelId: String(chatId),
          metadata: { chatId },
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    }

    if (this.sessionMap.size > 0) {
      this.logger.info({ sessionCount: this.sessionMap.size }, "Re-registered Telegram sessions");
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private findChatIdBySession(sessionId: string | undefined): number | null {
    if (!sessionId) return null;

    for (const [chatId, sid] of this.sessionMap.entries()) {
      if (sid === sessionId) return chatId;
    }

    return null;
  }

  /** Reset a specific session (used by /reset command) */
  resetSession(chatId: number): void {
    this.sessionMap.delete(chatId);
    this.logger.info({ chatId }, "Session reset");
  }

  /** Get session ID for a chat (used by commands) */
  getSessionId(chatId: number): string | undefined {
    return this.sessionMap.get(chatId);
  }
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"];
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";

  if (!botToken) {
    process.stderr.write("TELEGRAM_BOT_TOKEN environment variable is required" + "\n");
    process.exit(1);
  }

  const adapter = new TelegramAdapter({ botToken, gatewayUrl });

  const shutdown = async () => {
    await adapter.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await adapter.start();
}

// Run if executed directly
const isMainModule =
  typeof import.meta.url === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main().catch((error) => {
    process.stderr.write(`Fatal error: ${String(error)}\n`);
    process.exit(1);
  });
}
