import WebSocket from "ws";
import pino from "pino";
import { randomUUID } from "node:crypto";
import https from "node:https";
import fs from "node:fs";
import type {
  ProtocolMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  ToolApprovalRequestedMessage,
  StatusMessage,
  ErrorMessage,
} from "@karna/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

interface GoogleChatAdapterConfig {
  /** Path to the Google service account JSON key file */
  serviceAccountPath: string;
  /** The Google Chat space ID to listen in (e.g. spaces/AAAABBBB) */
  spaceId: string;
  gatewayUrl: string;
  /** Port for incoming webhook from Google Chat */
  webhookPort?: number;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface GoogleChatEvent {
  type: string;
  eventTime: string;
  message?: {
    name: string;
    sender: {
      name: string;
      displayName: string;
      email?: string;
      type: string;
    };
    createTime: string;
    text: string;
    thread?: {
      name: string;
    };
    space: {
      name: string;
      type: string;
    };
    argumentText?: string;
  };
  space?: {
    name: string;
    type: string;
  };
  user?: {
    name: string;
    displayName: string;
    email?: string;
  };
}

interface GoogleChatConversationInfo {
  conversationId: string;
  senderName: string;
  spaceName: string;
  threadName?: string;
  spaceType: string;
  isDirectMessage: boolean;
}

interface GoogleChatSessionInfo {
  sessionId: string;
  conversation: GoogleChatConversationInfo;
}

interface PendingResponse {
  conversation: GoogleChatConversationInfo;
  chunks: string[];
  streamComplete: boolean;
}

// ─── GoogleChatAdapter ──────────────────────────────────────────────────────

export class GoogleChatAdapter {
  private readonly config: GoogleChatAdapterConfig;
  private readonly logger: pino.Logger;
  private ws: WebSocket | null = null;
  private webhookServer: import("node:http").Server | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessionMap = new Map<string, GoogleChatSessionInfo>(); // conversationId -> session
  private pendingResponses = new Map<string, PendingResponse>(); // sessionId -> pending
  private isShuttingDown = false;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private credentials: ServiceAccountCredentials | null = null;

  constructor(config: GoogleChatAdapterConfig) {
    this.config = {
      webhookPort: 8443,
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:google-chat",
      level: process.env["LOG_LEVEL"] ?? "info",
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting Google Chat adapter");

    this.loadServiceAccountCredentials();
    await this.connectToGateway();
    this.startWebhookServer();

    this.logger.info("Google Chat adapter started");
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping Google Chat adapter");

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

    this.logger.info("Google Chat adapter stopped");
  }

  // ─── Service Account Authentication ─────────────────────────────────────

  private loadServiceAccountCredentials(): void {
    try {
      const raw = fs.readFileSync(this.config.serviceAccountPath, "utf-8");
      this.credentials = JSON.parse(raw) as ServiceAccountCredentials;
      this.logger.info(
        { clientEmail: this.credentials.client_email },
        "Loaded service account credentials",
      );
    } catch (error) {
      throw new Error(
        `Failed to load service account from ${this.config.serviceAccountPath}: ${String(error)}`,
      );
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    if (!this.credentials) {
      throw new Error("Service account credentials not loaded");
    }

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const claimSet = Buffer.from(
      JSON.stringify({
        iss: this.credentials.client_email,
        scope: "https://www.googleapis.com/auth/chat.bot",
        aud: this.credentials.token_uri,
        exp: now + 3600,
        iat: now,
      }),
    ).toString("base64url");

    const { createSign } = await import("node:crypto");
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claimSet}`);
    const signature = signer.sign(this.credentials.private_key, "base64url");

    const jwt = `${header}.${claimSet}.${signature}`;

    return new Promise<string>((resolve, reject) => {
      const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
      const tokenUrl = new URL(this.credentials!.token_uri);

      const req = https.request(
        {
          hostname: tokenUrl.hostname,
          port: tokenUrl.port || 443,
          path: tokenUrl.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(body) as { access_token: string; expires_in: number };
              this.accessToken = parsed.access_token;
              this.tokenExpiresAt = Date.now() + parsed.expires_in * 1000;
              resolve(this.accessToken);
            } catch {
              reject(new Error(`Failed to parse token response: ${body}`));
            }
          });
        },
      );

      req.on("error", (error) => reject(error));
      req.write(postData);
      req.end();
    });
  }

  // ─── Webhook Server (Incoming Messages) ─────────────────────────────────

  private startWebhookServer(): void {
    const http = require("node:http") as typeof import("node:http");
    const port = this.config.webhookPort ?? 8443;

    this.webhookServer = http.createServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end("Method Not Allowed");
        return;
      }

      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");

        this.handleIncomingEvent(body);
      });
    });

    this.webhookServer.listen(port, () => {
      this.logger.info({ port }, "Google Chat webhook server listening");
    });
  }

  private handleIncomingEvent(rawBody: string): void {
    let event: GoogleChatEvent;
    try {
      event = JSON.parse(rawBody) as GoogleChatEvent;
    } catch {
      this.logger.error("Failed to parse incoming Google Chat event");
      return;
    }

    if (event.type !== "MESSAGE" || !event.message) {
      this.logger.debug({ type: event.type }, "Ignoring non-message event");
      return;
    }

    const message = event.message;
    const senderName = message.sender.name;
    const text = message.argumentText ?? message.text;
    const spaceName = message.space.name;
    const threadName = message.thread?.name;
    const conversation = this.createConversationInfo(
      senderName,
      spaceName,
      threadName,
      message.space.type,
    );

    if (!text || message.sender.type === "BOT") return;

    this.logger.debug(
      {
        conversationId: conversation.conversationId,
        senderName,
        spaceName,
        threadName,
        textLength: text.length,
      },
      "Received Google Chat message",
    );

    void this.forwardToGateway(conversation, text, Boolean(message.argumentText));
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private async forwardToGateway(
    conversation: GoogleChatConversationInfo,
    content: string,
    agentMentioned: boolean,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn(
        { conversationId: conversation.conversationId },
        "Gateway not connected, cannot forward message",
      );
      return;
    }

    let session = this.sessionMap.get(conversation.conversationId);

    if (!session) {
      session = {
        sessionId: randomUUID(),
        conversation,
      };
      this.sessionMap.set(conversation.conversationId, session);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId: session.sessionId,
        payload: {
          channelType: "google-chat",
          channelId: conversation.conversationId,
          metadata: {
            spaceName: conversation.spaceName,
            threadName: conversation.threadName,
            spaceType: conversation.spaceType,
            userId: conversation.senderName,
            senderUserId: conversation.senderName,
            isDirectMessage: conversation.isDirectMessage,
          },
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    } else {
      session.conversation = conversation;
    }

    const chatMessage = {
      id: randomUUID(),
      type: "chat.message" as const,
      timestamp: Date.now(),
      sessionId: session.sessionId,
      payload: {
        content,
        role: "user" as const,
        metadata: {
          senderUserId: conversation.senderName,
          userId: conversation.senderName,
          spaceName: conversation.spaceName,
          threadName: conversation.threadName,
          spaceType: conversation.spaceType,
          isDirectMessage: conversation.isDirectMessage,
          agentMentioned,
        },
      },
    };

    this.ws.send(JSON.stringify(chatMessage));
    this.logger.debug(
      { conversationId: conversation.conversationId, sessionId: session.sessionId },
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
  }

  private async handleAgentResponse(message: AgentResponseMessage): Promise<void> {
    const session = this.findSessionById(message.sessionId);
    if (!session) {
      this.logger.warn({ sessionId: message.sessionId }, "No conversation found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    await this.sendToChannel(session.conversation, content);
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const session = this.findSessionById(sessionId);
    if (!session) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = {
        conversation: session.conversation,
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

      await this.sendToChannel(session.conversation, fullContent);
    }
  }

  private async handleToolApprovalRequest(
    message: ToolApprovalRequestedMessage,
  ): Promise<void> {
    const session = this.findSessionById(message.sessionId);
    if (!session) return;

    const { toolName, description, riskLevel, toolCallId } = message.payload;

    const text = [
      `*Tool Approval Required*`,
      ``,
      `Tool: ${toolName}`,
      `Risk: ${riskLevel}`,
      description ? `Description: ${description}` : "",
      ``,
      `Reply "approve" or "deny"`,
    ]
      .filter(Boolean)
      .join("\n");

    await this.sendToChannel(session.conversation, text);

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
    // Google Chat does not support typing indicators via API
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const session = this.findSessionById(message.sessionId);
    if (!session) return;

    const { code, message: errorMsg } = message.payload;

    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    await this.sendToChannel(
      session.conversation,
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
      payload: {
        clientTime: Date.now(),
      },
    };

    this.ws.send(JSON.stringify(ack));
  }

  // ─── Google Chat Message Sending ──────────────────────────────────────

  private async sendToChannel(conversation: GoogleChatConversationInfo, text: string): Promise<void> {
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (error) {
      this.logger.error({ error: String(error) }, "Failed to get access token");
      return;
    }

    const apiPath = `/v1/${conversation.spaceName}/messages`;
    const bodyPayload: Record<string, unknown> = { text };
    if (conversation.threadName) {
      bodyPayload["thread"] = { name: conversation.threadName };
    }
    const body = JSON.stringify(bodyPayload);

    return new Promise<void>((resolve) => {
      const req = https.request(
        {
          hostname: "chat.googleapis.com",
          port: 443,
          path: apiPath,
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            res.resume();
            resolve();
          } else {
            this.logger.error(
              { statusCode: res.statusCode, spaceName: conversation.spaceName },
              "Failed to send Google Chat message",
            );
            res.resume();
            resolve();
          }
        },
      );

      req.on("error", (error) => {
        this.logger.error(
          { error: error.message, spaceName: conversation.spaceName },
          "Google Chat send error",
        );
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

  private findSessionById(
    sessionId: string | undefined,
  ): GoogleChatSessionInfo | null {
    if (!sessionId) return null;

    for (const session of this.sessionMap.values()) {
      if (session.sessionId === sessionId) return session;
    }

    return null;
  }

  private createConversationInfo(
    senderName: string,
    spaceName: string,
    threadName: string | undefined,
    spaceType: string,
  ): GoogleChatConversationInfo {
    const normalizedThread = threadName ?? "root";
    return {
      conversationId: `${spaceName}:${normalizedThread}`,
      senderName,
      spaceName,
      threadName,
      spaceType,
      isDirectMessage: spaceType === "DM",
    };
  }

  private reregisterSessions(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const session of this.sessionMap.values()) {
      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId: session.sessionId,
        payload: {
          channelType: "google-chat",
          channelId: session.conversation.conversationId,
          metadata: {
            spaceName: session.conversation.spaceName,
            threadName: session.conversation.threadName,
            spaceType: session.conversation.spaceType,
            userId: session.conversation.senderName,
            senderUserId: session.conversation.senderName,
            isDirectMessage: session.conversation.isDirectMessage,
          },
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    }

    if (this.sessionMap.size > 0) {
      this.logger.info({ sessionCount: this.sessionMap.size }, "Re-registered Google Chat sessions");
    }
  }
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const serviceAccountPath = process.env["GOOGLE_SERVICE_ACCOUNT_PATH"];
  const spaceId = process.env["GOOGLE_CHAT_SPACE_ID"];
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";
  const webhookPort = process.env["GOOGLE_CHAT_WEBHOOK_PORT"]
    ? parseInt(process.env["GOOGLE_CHAT_WEBHOOK_PORT"], 10)
    : 8443;

  if (!serviceAccountPath) {
    process.stderr.write("GOOGLE_SERVICE_ACCOUNT_PATH environment variable is required\n");
    process.exit(1);
  }

  if (!spaceId) {
    process.stderr.write("GOOGLE_CHAT_SPACE_ID environment variable is required\n");
    process.exit(1);
  }

  const adapter = new GoogleChatAdapter({
    serviceAccountPath,
    spaceId,
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
