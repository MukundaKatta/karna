import WebSocket from "ws";
import pino from "pino";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import type {
  ProtocolMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  ToolApprovalRequestedMessage,
  StatusMessage,
  ErrorMessage,
} from "@karna/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

interface LineAdapterConfig {
  /** LINE channel access token */
  channelAccessToken: string;
  /** LINE channel secret for webhook signature validation */
  channelSecret: string;
  /** Port for the webhook server */
  webhookPort: number;
  gatewayUrl: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

interface LineWebhookBody {
  destination: string;
  events: LineEvent[];
}

interface LineEvent {
  type: string;
  replyToken?: string;
  timestamp: number;
  source: {
    type: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  message?: {
    id: string;
    type: string;
    text?: string;
    contentProvider?: {
      type: string;
    };
  };
}

interface LineConversationInfo {
  conversationId: string;
  senderUserId: string;
  isDirectMessage: boolean;
  conversationType: "user" | "group" | "room";
}

interface PendingResponse {
  conversationId: string;
  replyToken: string | null;
  chunks: string[];
  streamComplete: boolean;
}

// ─── LineAdapter ────────────────────────────────────────────────────────────

export class LineAdapter {
  private readonly config: LineAdapterConfig;
  private readonly logger: pino.Logger;
  private ws: WebSocket | null = null;
  private webhookServer: http.Server | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessionMap = new Map<string, string>(); // conversationId -> sessionId
  private pendingResponses = new Map<string, PendingResponse>(); // sessionId -> pending
  private replyTokens = new Map<string, string>(); // sessionId -> replyToken
  private isShuttingDown = false;

  constructor(config: LineAdapterConfig) {
    this.config = {
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:line",
      level: process.env["LOG_LEVEL"] ?? "info",
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting LINE adapter");

    await this.connectToGateway();
    this.startWebhookServer();

    this.logger.info("LINE adapter started");
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping LINE adapter");

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.webhookServer) {
      await new Promise<void>((resolve) => {
        this.webhookServer!.close(() => resolve());
      });
      this.webhookServer = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Adapter shutting down");
      this.ws = null;
    }

    this.logger.info("LINE adapter stopped");
  }

  // ─── Webhook Server (Incoming Messages) ─────────────────────────────────

  private startWebhookServer(): void {
    const port = this.config.webhookPort;

    this.webhookServer = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/webhook") {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      req.on("end", () => {
        const rawBody = Buffer.concat(chunks);
        const signature = req.headers["x-line-signature"] as string | undefined;

        if (!this.verifySignature(rawBody, signature)) {
          this.logger.warn("Invalid webhook signature, rejecting request");
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");

        this.handleWebhookBody(rawBody.toString("utf-8"));
      });
    });

    this.webhookServer.listen(port, () => {
      this.logger.info({ port }, "LINE webhook server listening");
    });
  }

  private verifySignature(body: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;

    const hmac = crypto.createHmac("SHA256", this.config.channelSecret);
    hmac.update(body);
    const digest = hmac.digest("base64");

    return crypto.timingSafeEqual(
      Buffer.from(digest, "utf-8"),
      Buffer.from(signature, "utf-8"),
    );
  }

  private handleWebhookBody(rawBody: string): void {
    let body: LineWebhookBody;
    try {
      body = JSON.parse(rawBody) as LineWebhookBody;
    } catch {
      this.logger.error("Failed to parse LINE webhook body");
      return;
    }

    for (const event of body.events) {
      this.handleLineEvent(event);
    }
  }

  private handleLineEvent(event: LineEvent): void {
    if (event.type !== "message") {
      this.logger.debug({ type: event.type }, "Ignoring non-message event");
      return;
    }

    if (!event.message || event.message.type !== "text" || !event.message.text) {
      this.logger.debug({ msgType: event.message?.type }, "Ignoring non-text message");
      return;
    }

    const text = event.message.text;
    const replyToken = event.replyToken ?? null;
    let conversation: LineConversationInfo;
    try {
      conversation = this.resolveConversationInfo(event);
    } catch (error) {
      this.logger.warn({ error: String(error) }, "Ignoring LINE event without a valid conversation target");
      return;
    }

    this.logger.debug(
      {
        conversationId: conversation.conversationId,
        senderUserId: conversation.senderUserId,
        isDirectMessage: conversation.isDirectMessage,
        textLength: text.length,
        hasReplyToken: !!replyToken,
      },
      "Received LINE message",
    );

    void this.forwardToGateway(conversation, text, replyToken);
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private async forwardToGateway(
    conversation: LineConversationInfo,
    content: string,
    replyToken: string | null,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn(
        { conversationId: conversation.conversationId },
        "Gateway not connected, cannot forward message",
      );
      return;
    }

    let sessionId = this.sessionMap.get(conversation.conversationId);

    if (!sessionId) {
      sessionId = randomUUID();
      this.sessionMap.set(conversation.conversationId, sessionId);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId,
        payload: {
          channelType: "line",
          channelId: conversation.conversationId,
          metadata: {
            conversationId: conversation.conversationId,
            userId: conversation.senderUserId,
            senderUserId: conversation.senderUserId,
            isDirectMessage: conversation.isDirectMessage,
            isGroup: !conversation.isDirectMessage,
            conversationType: conversation.conversationType,
          },
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    }

    // Store reply token for this session (they expire quickly)
    if (replyToken) {
      this.replyTokens.set(sessionId, replyToken);
    }

    const chatMessage = {
      id: randomUUID(),
      type: "chat.message" as const,
      timestamp: Date.now(),
      sessionId,
      payload: {
        content,
        role: "user" as const,
        metadata: {
          conversationId: conversation.conversationId,
          senderUserId: conversation.senderUserId,
          userId: conversation.senderUserId,
          isDirectMessage: conversation.isDirectMessage,
          isGroup: !conversation.isDirectMessage,
          conversationType: conversation.conversationType,
        },
      },
    };

    this.ws.send(JSON.stringify(chatMessage));
    this.logger.debug(
      {
        conversationId: conversation.conversationId,
        senderUserId: conversation.senderUserId,
        sessionId,
      },
      "Forwarded message to gateway",
    );
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
    const conversationId = this.findConversationBySession(message.sessionId);
    if (!conversationId) {
      this.logger.warn({ sessionId: message.sessionId }, "No conversation found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    await this.sendToChannel(conversationId, content, message.sessionId);
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const conversationId = this.findConversationBySession(sessionId);
    if (!conversationId) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = {
        conversationId,
        replyToken: this.replyTokens.get(sessionId) ?? null,
        chunks: [],
        streamComplete: false,
      };
      this.pendingResponses.set(sessionId, pending);
    }

    pending.chunks.push(message.payload.delta);

    if (message.payload.finishReason) {
      pending.streamComplete = true;
      const fullContent = pending.chunks.join("");
      this.pendingResponses.delete(sessionId);

      await this.sendToChannel(conversationId, fullContent, sessionId);
    }
  }

  private async handleToolApprovalRequest(
    message: ToolApprovalRequestedMessage,
  ): Promise<void> {
    const conversationId = this.findConversationBySession(message.sessionId);
    if (!conversationId) return;

    const { toolName, description, riskLevel, toolCallId } = message.payload;

    const text = [
      `[Tool Approval Required]`,
      ``,
      `Tool: ${toolName}`,
      `Risk: ${riskLevel}`,
      description ? `Description: ${description}` : "",
      ``,
      `Reply "approve" or "deny"`,
    ]
      .filter(Boolean)
      .join("\n");

    await this.sendToChannel(conversationId, text, message.sessionId);

    // Auto-approve low-risk tools
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

  private async handleStatusUpdate(_message: StatusMessage): Promise<void> {
    // LINE does not support typing indicators via Messaging API
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const conversationId = this.findConversationBySession(message.sessionId);
    if (!conversationId) return;

    const { code, message: errorMsg } = message.payload;

    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    await this.sendToChannel(
      conversationId,
      `An error occurred: ${errorMsg}\nPlease try again.`,
      message.sessionId,
    );
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

  // ─── LINE Message Sending ─────────────────────────────────────────────

  private async sendToChannel(
    conversationId: string,
    text: string,
    sessionId?: string,
  ): Promise<void> {
    // Try to use reply token first (faster and free), fall back to push
    const replyToken = sessionId ? this.replyTokens.get(sessionId) : undefined;

    if (replyToken) {
      this.replyTokens.delete(sessionId!);
      await this.replyMessage(replyToken, text);
    } else {
      await this.pushMessage(conversationId, text);
    }
  }

  private async replyMessage(replyToken: string, text: string): Promise<void> {
    const body = JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: this.truncateLineMessage(text) }],
    });

    return this.lineApiRequest("/v2/bot/message/reply", body);
  }

  private async pushMessage(conversationId: string, text: string): Promise<void> {
    const body = JSON.stringify({
      to: conversationId,
      messages: [{ type: "text", text: this.truncateLineMessage(text) }],
    });

    return this.lineApiRequest("/v2/bot/message/push", body);
  }

  private truncateLineMessage(text: string): string {
    // LINE text message limit is 5000 characters
    const maxLen = 5000;
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen - 3) + "...";
  }

  private async lineApiRequest(path: string, body: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const req = https.request(
        {
          hostname: "api.line.me",
          port: 443,
          path,
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.channelAccessToken}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            res.resume();
            resolve();
          } else {
            let responseBody = "";
            res.on("data", (chunk: Buffer) => {
              responseBody += chunk.toString();
            });
            res.on("end", () => {
              this.logger.error(
                { statusCode: res.statusCode, path, responseBody },
                "Failed to send LINE message",
              );
              resolve();
            });
          }
        },
      );

      req.on("error", (error) => {
        this.logger.error({ error: error.message, path }, "LINE API request error");
        resolve();
      });

      req.write(body);
      req.end();
    });
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

  // ─── Helpers ───────────────────────────────────────────────────────────

  private findConversationBySession(sessionId: string | undefined): string | null {
    if (!sessionId) return null;

    for (const [conversationId, sid] of this.sessionMap.entries()) {
      if (sid === sessionId) return conversationId;
    }

    return null;
  }

  private resolveConversationInfo(event: LineEvent): LineConversationInfo {
    switch (event.source.type) {
      case "group": {
        const conversationId = event.source.groupId;
        if (!conversationId) {
          throw new Error("LINE group message missing groupId");
        }
        return {
          conversationId,
          senderUserId: event.source.userId ?? conversationId,
          isDirectMessage: false,
          conversationType: "group",
        };
      }
      case "room": {
        const conversationId = event.source.roomId;
        if (!conversationId) {
          throw new Error("LINE room message missing roomId");
        }
        return {
          conversationId,
          senderUserId: event.source.userId ?? conversationId,
          isDirectMessage: false,
          conversationType: "room",
        };
      }
      default: {
        const conversationId = event.source.userId;
        if (!conversationId) {
          throw new Error("LINE direct message missing userId");
        }
        return {
          conversationId,
          senderUserId: conversationId,
          isDirectMessage: true,
          conversationType: "user",
        };
      }
    }
  }
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const channelAccessToken = process.env["LINE_CHANNEL_ACCESS_TOKEN"];
  const channelSecret = process.env["LINE_CHANNEL_SECRET"];
  const webhookPort = process.env["LINE_WEBHOOK_PORT"]
    ? parseInt(process.env["LINE_WEBHOOK_PORT"], 10)
    : 8080;
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";

  if (!channelAccessToken) {
    process.stderr.write("LINE_CHANNEL_ACCESS_TOKEN environment variable is required\n");
    process.exit(1);
  }

  if (!channelSecret) {
    process.stderr.write("LINE_CHANNEL_SECRET environment variable is required\n");
    process.exit(1);
  }

  const adapter = new LineAdapter({
    channelAccessToken,
    channelSecret,
    webhookPort,
    gatewayUrl,
  });

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
