import Twilio from "twilio";
import type { Twilio as TwilioClient } from "twilio";
import express, { type Request, type Response } from "express";
import type { Server } from "node:http";
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

// ─── Types ──────────────────────────────────────────────────────────────────

interface SMSAdapterConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  gatewayUrl: string;
  webhookPort?: number;
  webhookPath?: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

interface PendingResponse {
  phoneNumber: string;
  chunks: string[];
  streamComplete: boolean;
}

const SMS_SEGMENT_LENGTH = 160;
const SMS_MAX_CONCAT_LENGTH = 1600; // ~10 segments

// ─── SMSAdapter ─────────────────────────────────────────────────────────────

export class SMSAdapter {
  private readonly twilioClient: TwilioClient;
  private readonly expressApp: express.Application;
  private readonly config: SMSAdapterConfig;
  private readonly logger: pino.Logger;
  private server: Server | null = null;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessionMap = new Map<string, string>(); // fromNumber -> sessionId
  private pendingResponses = new Map<string, PendingResponse>();
  private isShuttingDown = false;

  constructor(config: SMSAdapterConfig) {
    this.config = {
      webhookPort: 3001,
      webhookPath: "/sms/webhook",
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:sms",
      level: process.env["LOG_LEVEL"] ?? "info",
    });

    this.twilioClient = Twilio(config.accountSid, config.authToken);
    this.expressApp = express();
    this.setupWebhook();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting SMS adapter");

    await this.connectToGateway();
    await this.startWebhookServer();

    this.logger.info(
      { port: this.config.webhookPort, path: this.config.webhookPath },
      "SMS adapter started",
    );
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping SMS adapter");

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

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.logger.info("SMS adapter stopped");
  }

  // ─── Webhook Server ───────────────────────────────────────────────────

  private setupWebhook(): void {
    this.expressApp.use(express.urlencoded({ extended: false }));
    this.expressApp.use(express.json());

    // Health check
    this.expressApp.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok", channel: "sms" });
    });

    // Twilio webhook for incoming SMS
    this.expressApp.post(
      this.config.webhookPath!,
      (req: Request, res: Response) => {
        void this.handleIncomingSMS(req, res);
      },
    );
  }

  private async startWebhookServer(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.server = this.expressApp.listen(this.config.webhookPort, () => {
        this.logger.info(
          { port: this.config.webhookPort },
          "Webhook server listening",
        );
        resolve();
      });
    });
  }

  // ─── Message Handling ─────────────────────────────────────────────────

  private async handleIncomingSMS(req: Request, res: Response): Promise<void> {
    const { From: from, Body: body, NumMedia: numMedia } = req.body as {
      From?: string;
      Body?: string;
      NumMedia?: string;
    };

    if (!from || !body) {
      res.status(400).send("Missing required fields");
      return;
    }

    this.logger.debug(
      { from, bodyLength: body.length, numMedia },
      "Received incoming SMS",
    );

    // Handle media attachments
    const attachments: Array<{ type: string; url?: string; name?: string }> = [];
    const mediaCount = parseInt(numMedia ?? "0", 10);

    for (let i = 0; i < mediaCount; i++) {
      const mediaUrl = (req.body as Record<string, string>)[`MediaUrl${i}`];
      const mediaType = (req.body as Record<string, string>)[`MediaContentType${i}`];

      if (mediaUrl) {
        const type = mediaType?.startsWith("image/")
          ? "image"
          : mediaType?.startsWith("video/")
            ? "video"
            : mediaType?.startsWith("audio/")
              ? "audio"
              : "document";

        attachments.push({ type, url: mediaUrl, name: `media-${i}` });
      }
    }

    await this.forwardToGateway(
      from,
      body,
      attachments.length > 0 ? attachments : undefined,
    );

    // Respond with empty TwiML to acknowledge receipt
    res.type("text/xml");
    res.send("<Response></Response>");
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private async forwardToGateway(
    fromNumber: string,
    content: string,
    attachments?: Array<{ type: string; url?: string; data?: string; name?: string }>,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn({ fromNumber }, "Gateway not connected, cannot forward message");
      await this.sendSMS(
        fromNumber,
        "I'm currently reconnecting. Please try again in a moment.",
      );
      return;
    }

    let sessionId = this.sessionMap.get(fromNumber);

    if (!sessionId) {
      sessionId = randomUUID();
      this.sessionMap.set(fromNumber, sessionId);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "sms",
          channelId: fromNumber,
          metadata: { phoneNumber: fromNumber },
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
    this.logger.debug({ fromNumber, sessionId }, "Forwarded message to gateway");
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
        // SMS has no typing indicator
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
    const phoneNumber = this.findPhoneBySession(message.sessionId);
    if (!phoneNumber) {
      this.logger.warn({ sessionId: message.sessionId }, "No phone found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    await this.sendSMSWithSplitting(phoneNumber, content);
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const phoneNumber = this.findPhoneBySession(sessionId);
    if (!phoneNumber) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = { phoneNumber, chunks: [], streamComplete: false };
      this.pendingResponses.set(sessionId, pending);
    }

    pending.chunks.push(message.payload.delta);

    if (message.payload.finishReason) {
      pending.streamComplete = true;
      const fullContent = pending.chunks.join("");
      this.pendingResponses.delete(sessionId);

      await this.sendSMSWithSplitting(phoneNumber, fullContent);
    }
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const phoneNumber = this.findPhoneBySession(message.sessionId);
    if (!phoneNumber) return;

    const { code, message: errorMsg } = message.payload;
    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    await this.sendSMS(phoneNumber, `Error: ${errorMsg}. Please try again.`);
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

  // ─── SMS Sending ──────────────────────────────────────────────────────

  private async sendSMS(to: string, body: string): Promise<void> {
    try {
      await this.twilioClient.messages.create({
        to,
        from: this.config.phoneNumber,
        body,
      });

      this.logger.debug({ to, bodyLength: body.length }, "SMS sent");
    } catch (error) {
      this.logger.error({ error, to }, "Failed to send SMS");
    }
  }

  /**
   * Split long messages into SMS-friendly chunks and send them sequentially.
   * Each SMS segment is 160 characters. For concatenated SMS, carriers
   * usually support up to ~1600 characters (10 segments).
   */
  private async sendSMSWithSplitting(
    to: string,
    content: string,
  ): Promise<void> {
    if (content.length <= SMS_MAX_CONCAT_LENGTH) {
      // Send as single (possibly concatenated) SMS
      await this.sendSMS(to, content);
      return;
    }

    // Split into multiple separate SMS messages
    const chunks = splitForSMS(content, SMS_MAX_CONCAT_LENGTH);

    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? `(${i + 1}/${chunks.length}) ` : "";
      await this.sendSMS(to, prefix + chunks[i]);
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

  private findPhoneBySession(sessionId: string | undefined): string | null {
    if (!sessionId) return null;

    for (const [phone, sid] of this.sessionMap.entries()) {
      if (sid === sessionId) return phone;
    }

    return null;
  }

  resetSession(phoneNumber: string): void {
    this.sessionMap.delete(phoneNumber);
    this.logger.info({ phoneNumber }, "Session reset");
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

function splitForSMS(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at sentence boundaries
    let splitIndex = remaining.lastIndexOf(". ", maxLen);
    if (splitIndex <= maxLen * 0.3) {
      splitIndex = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIndex <= 0) {
      splitIndex = maxLen;
    } else {
      splitIndex += 1; // Include the period/space
    }

    chunks.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const accountSid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  const phoneNumber = process.env["TWILIO_PHONE_NUMBER"];
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";
  const webhookPort = parseInt(process.env["SMS_WEBHOOK_PORT"] ?? "3001", 10);

  if (!accountSid) {
    console.error("TWILIO_ACCOUNT_SID environment variable is required");
    process.exit(1);
  }

  if (!authToken) {
    console.error("TWILIO_AUTH_TOKEN environment variable is required");
    process.exit(1);
  }

  if (!phoneNumber) {
    console.error("TWILIO_PHONE_NUMBER environment variable is required");
    process.exit(1);
  }

  const adapter = new SMSAdapter({
    accountSid,
    authToken,
    phoneNumber,
    gatewayUrl,
    webhookPort,
  });

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
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
