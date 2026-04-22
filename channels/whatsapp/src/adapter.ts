import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type WAMessage,
  type BaileysEventMap,
  type ConnectionState,
  type MessageUpsertType,
} from "@whiskeysockets/baileys";
import WebSocket from "ws";
import pino from "pino";
import { randomUUID } from "node:crypto";
// Boom type for disconnect reason checking
type BoomError = Error & { output?: { statusCode?: number } };
import type {
  ProtocolMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  StatusMessage,
  ErrorMessage,
} from "@karna/shared";
import { initAuthState, displayQRCode } from "./auth.js";
import { formatForWhatsApp, splitLongMessage } from "./formatter.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface WhatsAppAdapterConfig {
  gatewayUrl: string;
  authDir?: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
  maxRetries?: number;
}

interface PendingResponse {
  jid: string;
  chunks: string[];
  streamComplete: boolean;
}

interface RetryableMessage {
  jid: string;
  content: string;
  retries: number;
}

interface WhatsAppRoutingMetadata extends Record<string, unknown> {
  jid: string;
  userId: string;
  senderUserId: string;
  isDirectMessage: boolean;
  isGroup: boolean;
  conversationType: "dm" | "group";
}

// ─── WhatsAppAdapter ────────────────────────────────────────────────────────

export class WhatsAppAdapter {
  private readonly config: WhatsAppAdapterConfig;
  private readonly logger: pino.Logger;
  private sock: WASocket | null = null;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessionMap = new Map<string, string>(); // jid -> sessionId
  private pendingResponses = new Map<string, PendingResponse>();
  private retryQueue = new Map<string, RetryableMessage>();
  private isShuttingDown = false;

  constructor(config: WhatsAppAdapterConfig) {
    this.config = {
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      maxRetries: 3,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:whatsapp",
      level: process.env["LOG_LEVEL"] ?? "info",
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting WhatsApp adapter");

    await this.connectToGateway();
    await this.connectToWhatsApp();
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping WhatsApp adapter");

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

    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }

    this.logger.info("WhatsApp adapter stopped");
  }

  // ─── WhatsApp Connection ──────────────────────────────────────────────

  private async connectToWhatsApp(): Promise<void> {
    const { state, saveCreds } = await initAuthState(this.config.authDir);
    const { version } = await fetchLatestBaileysVersion();

    this.logger.info({ version }, "Connecting to WhatsApp");

    const waLogger = pino({ level: "silent" });

    const makeSocket = (makeWASocket as any).default ?? makeWASocket;
    this.sock = makeSocket({
      version,
      logger: waLogger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, waLogger),
      },
      printQRInTerminal: false,
      generateHighQualityLinkPreview: true,
    });

    // Handle connection updates
    this.sock!.ev.on("connection.update", (update: Partial<ConnectionState>) => {
      this.handleConnectionUpdate(update);
    });

    // Save credentials on update
    this.sock!.ev.on("creds.update", saveCreds);

    // Handle incoming messages
    this.sock!.ev.on(
      "messages.upsert",
      (m: { messages: WAMessage[]; type: MessageUpsertType }) => {
        void this.handleMessagesUpsert(m.messages, m.type);
      },
    );
  }

  private handleConnectionUpdate(update: Partial<ConnectionState>): void {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      displayQRCode(qr);
    }

    if (connection === "close") {
      const error = lastDisconnect?.error as BoomError | undefined;
      const statusCode = error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      this.logger.warn(
        { statusCode, shouldReconnect },
        "WhatsApp connection closed",
      );

      if (shouldReconnect && !this.isShuttingDown) {
        void this.connectToWhatsApp();
      } else if (statusCode === DisconnectReason.loggedOut) {
        this.logger.error("WhatsApp logged out — delete auth folder and re-scan QR");
      }
    } else if (connection === "open") {
      this.logger.info("WhatsApp connection established");
    }
  }

  // ─── Message Handling ─────────────────────────────────────────────────

  private async handleMessagesUpsert(
    messages: WAMessage[],
    type: MessageUpsertType,
  ): Promise<void> {
    if (type !== "notify") return;

    for (const msg of messages) {
      // Skip messages from self
      if (msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;
      if (!jid) continue;

      // Skip status broadcasts
      if (jid === "status@broadcast") continue;

      await this.processMessage(msg, jid);
    }
  }

  private async processMessage(msg: WAMessage, jid: string): Promise<void> {
    const messageContent = msg.message;
    if (!messageContent) return;
    const routing = this.createRoutingMetadata(msg, jid);

    // Handle text messages
    const text =
      messageContent.conversation ??
      messageContent.extendedTextMessage?.text ??
      null;

    if (text) {
      this.logger.debug({ jid, textLength: text.length }, "Received text message");
      await this.forwardToGateway(jid, text, undefined, routing);
      return;
    }

    // Handle image messages
    if (messageContent.imageMessage) {
      const caption = messageContent.imageMessage.caption ?? "User sent an image.";
      this.logger.debug({ jid }, "Received image message");
      await this.forwardToGateway(jid, caption, [
        { type: "image", name: "image" },
      ], routing);
      return;
    }

    // Handle video messages
    if (messageContent.videoMessage) {
      const caption = messageContent.videoMessage.caption ?? "User sent a video.";
      this.logger.debug({ jid }, "Received video message");
      await this.forwardToGateway(jid, caption, [
        { type: "video", name: "video" },
      ], routing);
      return;
    }

    // Handle document messages
    if (messageContent.documentMessage) {
      const fileName = messageContent.documentMessage.fileName ?? "document";
      const caption =
        messageContent.documentMessage.caption ?? `User sent a document: ${fileName}`;
      this.logger.debug({ jid, fileName }, "Received document message");
      await this.forwardToGateway(jid, caption, [
        { type: "document", name: fileName },
      ], routing);
      return;
    }

    // Handle audio messages
    if (messageContent.audioMessage) {
      this.logger.debug({ jid }, "Received audio message");
      await this.forwardToGateway(jid, "User sent an audio message.", [
        { type: "audio", name: "audio" },
      ], routing);
      return;
    }
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private async forwardToGateway(
    jid: string,
    content: string,
    attachments?: Array<{ type: string; url?: string; data?: string; name?: string }>,
    routing?: WhatsAppRoutingMetadata,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn({ jid }, "Gateway not connected, cannot forward message");
      await this.sendWhatsAppMessage(
        jid,
        "I'm currently reconnecting to my backend. Please try again in a moment.",
      );
      return;
    }

    let sessionId = this.sessionMap.get(jid);

    if (!sessionId) {
      sessionId = randomUUID();
      this.sessionMap.set(jid, sessionId);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId,
        payload: {
          channelType: "whatsapp",
          channelId: jid,
          metadata: routing ?? this.createFallbackRoutingMetadata(jid),
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    }

    const payload: Record<string, unknown> = {
      content,
      role: "user" as const,
      metadata: routing ?? this.createFallbackRoutingMetadata(jid),
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
    this.logger.debug({ jid, sessionId }, "Forwarded message to gateway");
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
    const jid = this.findJidBySession(message.sessionId);
    if (!jid) {
      this.logger.warn({ sessionId: message.sessionId }, "No chat found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    const formatted = formatForWhatsApp(content);
    const chunks = splitLongMessage(formatted);

    for (const chunk of chunks) {
      await this.sendWhatsAppMessage(jid, chunk);
    }
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const jid = this.findJidBySession(sessionId);
    if (!jid) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = { jid, chunks: [], streamComplete: false };
      this.pendingResponses.set(sessionId, pending);
    }

    pending.chunks.push(message.payload.delta);

    if (message.payload.finishReason) {
      pending.streamComplete = true;
      const fullContent = pending.chunks.join("");
      this.pendingResponses.delete(sessionId);

      const formatted = formatForWhatsApp(fullContent);
      const parts = splitLongMessage(formatted);

      for (const part of parts) {
        await this.sendWhatsAppMessage(jid, part);
      }
    }
  }

  private async handleStatusUpdate(message: StatusMessage): Promise<void> {
    const jid = this.findJidBySession(message.sessionId);
    if (!jid) return;

    const { state } = message.payload;

    if (state === "thinking" && this.sock) {
      try {
        await this.sock.presenceSubscribe(jid);
        await this.sock.sendPresenceUpdate("composing", jid);
      } catch {
        // Ignore presence update errors
      }
    }
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const jid = this.findJidBySession(message.sessionId);
    if (!jid) return;

    const { code, message: errorMsg } = message.payload;
    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    await this.sendWhatsAppMessage(
      jid,
      `An error occurred: ${errorMsg}\nPlease try again.`,
    );
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

  // ─── Send with Retry ─────────────────────────────────────────────────

  private async sendWhatsAppMessage(jid: string, text: string): Promise<void> {
    const maxRetries = this.config.maxRetries ?? 3;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (!this.sock) {
          throw new Error("WhatsApp socket not connected");
        }

        await this.sock.sendMessage(jid, { text });
        return;
      } catch (error) {
        this.logger.warn(
          { jid, attempt, error: String(error) },
          "Failed to send WhatsApp message",
        );

        if (attempt === maxRetries) {
          this.logger.error({ jid }, "Exhausted retries for WhatsApp message");
        } else {
          // Wait before retry with exponential backoff
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 60_000)),
          );
        }
      }
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

  private createRoutingMetadata(msg: WAMessage, jid: string): WhatsAppRoutingMetadata {
    const isGroup = jid.endsWith("@g.us");
    const senderUserId = msg.key.participant ?? jid;
    return {
      jid,
      userId: senderUserId,
      senderUserId,
      isDirectMessage: !isGroup,
      isGroup,
      conversationType: isGroup ? "group" : "dm",
    };
  }

  private createFallbackRoutingMetadata(jid: string): WhatsAppRoutingMetadata {
    const isGroup = jid.endsWith("@g.us");
    return {
      jid,
      userId: jid,
      senderUserId: jid,
      isDirectMessage: !isGroup,
      isGroup,
      conversationType: isGroup ? "group" : "dm",
    };
  }

  private findJidBySession(sessionId: string | undefined): string | null {
    if (!sessionId) return null;

    for (const [jid, sid] of this.sessionMap.entries()) {
      if (sid === sessionId) return jid;
    }

    return null;
  }

  resetSession(jid: string): void {
    this.sessionMap.delete(jid);
    this.logger.info({ jid }, "Session reset");
  }

  getSessionId(jid: string): string | undefined {
    return this.sessionMap.get(jid);
  }
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";

  const adapter = new WhatsAppAdapter({ gatewayUrl });

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
