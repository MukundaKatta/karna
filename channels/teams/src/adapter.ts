import WebSocket from "ws";
import pino from "pino";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import type {
  ProtocolMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  ToolApprovalRequestedMessage,
  StatusMessage,
  ErrorMessage,
} from "@karna/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TeamsAdapterConfig {
  /** Microsoft Bot Framework app ID */
  appId: string;
  /** Microsoft Bot Framework app password */
  appPassword: string;
  /** Azure AD tenant ID */
  tenantId: string;
  gatewayUrl: string;
  /** Port for the bot endpoint server */
  botPort?: number;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

interface TeamsActivity {
  type: string;
  id: string;
  timestamp: string;
  channelId: string;
  from: {
    id: string;
    name: string;
    aadObjectId?: string;
  };
  conversation: {
    id: string;
    conversationType?: string;
    tenantId?: string;
    isGroup?: boolean;
  };
  recipient: {
    id: string;
    name: string;
  };
  text?: string;
  serviceUrl: string;
  channelData?: Record<string, unknown>;
}

interface ConversationReference {
  serviceUrl: string;
  conversationId: string;
  activityId: string;
  botId: string;
  userId: string;
}

interface PendingResponse {
  conversationRef: ConversationReference;
  chunks: string[];
  streamComplete: boolean;
}

// ─── TeamsAdapter ───────────────────────────────────────────────────────────

export class TeamsAdapter {
  private readonly config: TeamsAdapterConfig;
  private readonly logger: pino.Logger;
  private ws: WebSocket | null = null;
  private botServer: http.Server | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessionMap = new Map<string, string>(); // conversationId -> sessionId
  private conversationRefs = new Map<string, ConversationReference>(); // sessionId -> ref
  private pendingResponses = new Map<string, PendingResponse>(); // sessionId -> pending
  private isShuttingDown = false;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: TeamsAdapterConfig) {
    this.config = {
      botPort: 3978,
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:teams",
      level: process.env["LOG_LEVEL"] ?? "info",
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting Microsoft Teams adapter");

    await this.connectToGateway();
    this.startBotServer();

    this.logger.info("Microsoft Teams adapter started");
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping Microsoft Teams adapter");

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.botServer) {
      await new Promise<void>((resolve) => {
        this.botServer!.close(() => resolve());
      });
      this.botServer = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Adapter shutting down");
      this.ws = null;
    }

    this.logger.info("Microsoft Teams adapter stopped");
  }

  // ─── Bot Framework Authentication ───────────────────────────────────────

  private async getBotFrameworkToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;
    const postData = [
      `grant_type=client_credentials`,
      `client_id=${encodeURIComponent(this.config.appId)}`,
      `client_secret=${encodeURIComponent(this.config.appPassword)}`,
      `scope=${encodeURIComponent("https://api.botframework.com/.default")}`,
    ].join("&");

    return new Promise<string>((resolve, reject) => {
      const parsedUrl = new URL(tokenUrl);

      const req = https.request(
        {
          hostname: parsedUrl.hostname,
          port: 443,
          path: parsedUrl.pathname,
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

  // ─── Bot Endpoint Server ────────────────────────────────────────────────

  private startBotServer(): void {
    const port = this.config.botPort ?? 3978;

    this.botServer = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/api/messages") {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");

        this.handleIncomingActivity(body);
      });
    });

    this.botServer.listen(port, () => {
      this.logger.info({ port }, "Teams bot endpoint listening");
    });
  }

  private handleIncomingActivity(rawBody: string): void {
    let activity: TeamsActivity;
    try {
      activity = JSON.parse(rawBody) as TeamsActivity;
    } catch {
      this.logger.error("Failed to parse incoming Teams activity");
      return;
    }

    if (activity.type !== "message" || !activity.text) {
      this.logger.debug({ type: activity.type }, "Ignoring non-message activity");
      return;
    }

    const conversationId = activity.conversation.id;
    const senderName = activity.from.name;
    const text = activity.text;

    const conversationRef: ConversationReference = {
      serviceUrl: activity.serviceUrl,
      conversationId,
      activityId: activity.id,
      botId: activity.recipient.id,
      userId: activity.from.id,
    };

    this.logger.debug(
      { senderName, conversationId, textLength: text.length },
      "Received Teams message",
    );

    void this.forwardToGateway(
      conversationId,
      text,
      senderName,
      conversationRef,
      activity.from.id,
      activity.conversation.conversationType,
      Boolean(activity.conversation.isGroup),
    );
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private async forwardToGateway(
    conversationId: string,
    content: string,
    senderName: string,
    conversationRef: ConversationReference,
    userId: string,
    conversationType: string | undefined,
    isGroup: boolean,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn({ conversationId }, "Gateway not connected, cannot forward message");
      return;
    }

    let sessionId = this.sessionMap.get(conversationId);

    if (!sessionId) {
      sessionId = randomUUID();
      this.sessionMap.set(conversationId, sessionId);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "teams",
          channelId: conversationId,
          metadata: {
            senderName,
            conversationId,
            userId,
            conversationType,
            isGroup,
            isDirectMessage: !isGroup && conversationType !== "channel",
          },
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    }

    this.conversationRefs.set(sessionId, conversationRef);

    const chatMessage = {
      id: randomUUID(),
      type: "chat.message" as const,
      timestamp: Date.now(),
      sessionId,
      payload: {
        content,
        role: "user" as const,
        metadata: {
          senderUserId: userId,
          isDirectMessage: !isGroup && conversationType !== "channel",
          agentMentioned: isGroup,
        },
      },
    };

    this.ws.send(JSON.stringify(chatMessage));
    this.logger.debug({ conversationId, sessionId }, "Forwarded message to gateway");
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

    for (const [conversationId, sid] of this.sessionMap.entries()) {
      if (sid === message.sessionId || !this.sessionMap.has(conversationId)) {
        this.sessionMap.set(conversationId, sessionId);
        break;
      }
    }
  }

  private async handleAgentResponse(message: AgentResponseMessage): Promise<void> {
    const ref = this.conversationRefs.get(message.sessionId ?? "");
    if (!ref) {
      this.logger.warn({ sessionId: message.sessionId }, "No conversation ref found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    await this.sendToChannel(ref, content);
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const ref = this.conversationRefs.get(sessionId);
    if (!ref) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = { conversationRef: ref, chunks: [], streamComplete: false };
      this.pendingResponses.set(sessionId, pending);
    }

    pending.chunks.push(message.payload.delta);

    if (message.payload.finishReason) {
      pending.streamComplete = true;
      const fullContent = pending.chunks.join("");
      this.pendingResponses.delete(sessionId);

      await this.sendToChannel(ref, fullContent);
    }
  }

  private async handleToolApprovalRequest(
    message: ToolApprovalRequestedMessage,
  ): Promise<void> {
    const ref = this.conversationRefs.get(message.sessionId ?? "");
    if (!ref) return;

    const { toolName, description, riskLevel, toolCallId } = message.payload;

    const text = [
      `**Tool Approval Required**`,
      ``,
      `Tool: ${toolName}`,
      `Risk: ${riskLevel}`,
      description ? `Description: ${description}` : "",
      ``,
      `Reply "approve" or "deny"`,
    ]
      .filter(Boolean)
      .join("\n");

    await this.sendToChannel(ref, text);

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

  private async handleStatusUpdate(message: StatusMessage): Promise<void> {
    const ref = this.conversationRefs.get(message.sessionId ?? "");
    if (!ref) return;

    // Send typing indicator via Bot Framework
    void this.sendTypingIndicator(ref);
  }

  private async sendTypingIndicator(ref: ConversationReference): Promise<void> {
    let token: string;
    try {
      token = await this.getBotFrameworkToken();
    } catch {
      return;
    }

    const activity = {
      type: "typing",
      from: { id: ref.botId },
    };

    const apiUrl = `${ref.serviceUrl}/v3/conversations/${ref.conversationId}/activities`;
    const body = JSON.stringify(activity);
    const parsedUrl = new URL(apiUrl);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    return new Promise<void>((resolve) => {
      const req = transport.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", () => resolve());
      req.write(body);
      req.end();
    });
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const ref = this.conversationRefs.get(message.sessionId ?? "");
    if (!ref) return;

    const { code, message: errorMsg } = message.payload;

    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    await this.sendToChannel(
      ref,
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

  // ─── Teams Message Sending ─────────────────────────────────────────────

  private async sendToChannel(ref: ConversationReference, text: string): Promise<void> {
    let token: string;
    try {
      token = await this.getBotFrameworkToken();
    } catch (error) {
      this.logger.error({ error: String(error) }, "Failed to get Bot Framework token");
      return;
    }

    const activity = {
      type: "message",
      from: { id: ref.botId },
      text,
      textFormat: "markdown",
    };

    const apiUrl = `${ref.serviceUrl}/v3/conversations/${ref.conversationId}/activities`;
    const body = JSON.stringify(activity);
    const parsedUrl = new URL(apiUrl);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    return new Promise<void>((resolve) => {
      const req = transport.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
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
              { statusCode: res.statusCode, conversationId: ref.conversationId },
              "Failed to send Teams message",
            );
            res.resume();
            resolve();
          }
        },
      );

      req.on("error", (error) => {
        this.logger.error(
          { error: error.message, conversationId: ref.conversationId },
          "Teams send error",
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

  private findConversationIdBySession(sessionId: string | undefined): string | null {
    if (!sessionId) return null;

    for (const [conversationId, sid] of this.sessionMap.entries()) {
      if (sid === sessionId) return conversationId;
    }

    return null;
  }
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const appId = process.env["TEAMS_APP_ID"];
  const appPassword = process.env["TEAMS_APP_PASSWORD"];
  const tenantId = process.env["TEAMS_TENANT_ID"];
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";
  const botPort = process.env["TEAMS_BOT_PORT"]
    ? parseInt(process.env["TEAMS_BOT_PORT"], 10)
    : 3978;

  if (!appId) {
    process.stderr.write("TEAMS_APP_ID environment variable is required\n");
    process.exit(1);
  }

  if (!appPassword) {
    process.stderr.write("TEAMS_APP_PASSWORD environment variable is required\n");
    process.exit(1);
  }

  if (!tenantId) {
    process.stderr.write("TEAMS_TENANT_ID environment variable is required\n");
    process.exit(1);
  }

  const adapter = new TeamsAdapter({
    appId,
    appPassword,
    tenantId,
    gatewayUrl,
    botPort,
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
