import WebSocket from "ws";
import pino from "pino";
import { randomUUID } from "node:crypto";
import https from "node:https";
import http from "node:http";
import { PersistentSessionMap } from "@karna/shared";
import type {
  ProtocolMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  ToolApprovalRequestedMessage,
  StatusMessage,
  ErrorMessage,
} from "@karna/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

interface MatrixAdapterConfig {
  /** Matrix homeserver URL (e.g. https://matrix.org) */
  homeserverUrl: string;
  /** Bot access token for the Matrix homeserver */
  accessToken: string;
  /** Fully-qualified Matrix user ID (e.g. @bot:matrix.org) */
  userId: string;
  gatewayUrl: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

interface MatrixSyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<
      string,
      {
        timeline?: {
          events?: MatrixEvent[];
        };
      }
    >;
    invite?: Record<string, unknown>;
  };
}

interface MatrixEvent {
  type: string;
  event_id: string;
  sender: string;
  origin_server_ts: number;
  content: {
    msgtype?: string;
    body?: string;
    membership?: string;
    [key: string]: unknown;
  };
  room_id?: string;
}

interface MatrixConversationInfo {
  roomId: string;
  senderUserId: string;
  isDirectMessage: boolean;
  conversationType: "dm" | "room";
}

interface PendingResponse {
  roomId: string;
  chunks: string[];
  streamComplete: boolean;
}

// ─── MatrixAdapter ──────────────────────────────────────────────────────────

export class MatrixAdapter {
  private readonly config: MatrixAdapterConfig;
  private readonly logger: pino.Logger;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sessionMap: PersistentSessionMap<string, string>;
  private roomDirectness = new Map<string, boolean>(); // roomId -> isDirectMessage
  private pendingResponses = new Map<string, PendingResponse>(); // sessionId -> pending
  private isShuttingDown = false;
  private syncToken: string | null = null;

  constructor(config: MatrixAdapterConfig) {
    this.config = {
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:matrix",
      level: process.env["LOG_LEVEL"] ?? "info",
    });

    this.sessionMap = new PersistentSessionMap<string, string>({
      name: "matrix",
      logger: this.logger,
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting Matrix adapter");

    await this.sessionMap.load();
    await this.connectToGateway();
    await this.performInitialSync();
    this.startSyncLoop();

    this.logger.info("Matrix adapter started");
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping Matrix adapter");

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Adapter shutting down");
      this.ws = null;
    }

    await this.sessionMap.flush();
    this.logger.info("Matrix adapter stopped");
  }

  // ─── Matrix Sync ───────────────────────────────────────────────────────

  private async performInitialSync(): Promise<void> {
    this.logger.info("Performing initial Matrix sync");

    try {
      const response = await this.matrixRequest<MatrixSyncResponse>(
        "GET",
        `/_matrix/client/v3/sync?timeout=0&filter={"room":{"timeline":{"limit":0}}}`,
      );
      this.syncToken = response.next_batch;
      this.logger.info({ syncToken: this.syncToken }, "Initial sync complete");
    } catch (error) {
      this.logger.error({ error: String(error) }, "Initial sync failed");
      throw error;
    }
  }

  private startSyncLoop(): void {
    if (this.isShuttingDown) return;

    const doSync = async () => {
      if (this.isShuttingDown) return;

      try {
        const query = `timeout=30000&since=${this.syncToken}`;
        const response = await this.matrixRequest<MatrixSyncResponse>(
          "GET",
          `/_matrix/client/v3/sync?${query}`,
        );

        this.syncToken = response.next_batch;

        if (response.rooms?.join) {
          for (const [roomId, roomData] of Object.entries(response.rooms.join)) {
            const events = roomData.timeline?.events ?? [];
            for (const event of events) {
              await this.handleMatrixEvent(roomId, event);
            }
          }
        }

        // Auto-accept invites
        if (response.rooms?.invite) {
          for (const roomId of Object.keys(response.rooms.invite)) {
            this.logger.info({ roomId }, "Auto-joining invited room");
            void this.matrixRequest("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`, {});
          }
        }
      } catch (error) {
        this.logger.error({ error: String(error) }, "Sync loop error");
      }

      if (!this.isShuttingDown) {
        this.syncTimer = setTimeout(() => void doSync(), 1_000);
      }
    };

    void doSync();
  }

  private async handleMatrixEvent(roomId: string, event: MatrixEvent): Promise<void> {
    // Ignore our own messages
    if (event.sender === this.config.userId) return;

    // Only handle text messages
    if (event.type !== "m.room.message") return;
    if (event.content.msgtype !== "m.text") return;

    const text = event.content.body;
    if (!text) return;

    const senderUserId = event.sender;
    const conversation = await this.resolveConversationInfo(roomId, senderUserId);

    this.logger.debug(
      {
        senderUserId,
        roomId,
        isDirectMessage: conversation.isDirectMessage,
        textLength: text.length,
      },
      "Received Matrix message",
    );

    await this.forwardToGateway(conversation, text);
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private async forwardToGateway(
    conversation: MatrixConversationInfo,
    content: string,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn({ roomId: conversation.roomId }, "Gateway not connected, cannot forward message");
      return;
    }

    let sessionId = this.sessionMap.get(conversation.roomId);

    if (!sessionId) {
      sessionId = randomUUID();
      this.sessionMap.set(conversation.roomId, sessionId);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId,
        payload: {
          channelType: "matrix",
          channelId: conversation.roomId,
          metadata: {
            roomId: conversation.roomId,
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

    const chatMessage = {
      id: randomUUID(),
      type: "chat.message" as const,
      timestamp: Date.now(),
      sessionId,
      payload: {
        content,
        role: "user" as const,
        metadata: {
          senderUserId: conversation.senderUserId,
          userId: conversation.senderUserId,
          roomId: conversation.roomId,
          isDirectMessage: conversation.isDirectMessage,
          isGroup: !conversation.isDirectMessage,
          conversationType: conversation.conversationType,
        },
      },
    };

    this.ws.send(JSON.stringify(chatMessage));
    this.logger.debug(
      { roomId: conversation.roomId, senderUserId: conversation.senderUserId, sessionId },
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
    const roomId = this.findRoomIdBySession(message.sessionId);
    if (!roomId) {
      this.logger.warn({ sessionId: message.sessionId }, "No room found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    await this.sendToChannel(roomId, content);
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const roomId = this.findRoomIdBySession(sessionId);
    if (!roomId) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = {
        roomId,
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

      await this.sendToChannel(roomId, fullContent);
    }
  }

  private async handleToolApprovalRequest(
    message: ToolApprovalRequestedMessage,
  ): Promise<void> {
    const roomId = this.findRoomIdBySession(message.sessionId);
    if (!roomId) return;

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

    await this.sendToChannel(roomId, text);

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
    const roomId = this.findRoomIdBySession(message.sessionId);
    if (!roomId) return;

    // Send typing notification via Matrix API
    void this.matrixRequest(
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(this.config.userId)}`,
      { typing: true, timeout: 10_000 },
    ).catch(() => {
      // Typing indicators are best-effort
    });
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const roomId = this.findRoomIdBySession(message.sessionId);
    if (!roomId) return;

    const { code, message: errorMsg } = message.payload;

    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    await this.sendToChannel(
      roomId,
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

  // ─── Matrix Message Sending ────────────────────────────────────────────

  private async sendToChannel(roomId: string, text: string): Promise<void> {
    const txnId = randomUUID();
    const eventBody = {
      msgtype: "m.text",
      body: text,
    };

    try {
      await this.matrixRequest(
        "PUT",
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
        eventBody,
      );
    } catch (error) {
      this.logger.error({ error: String(error), roomId }, "Failed to send Matrix message");
    }
  }

  private async matrixRequest<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const parsedUrl = new URL(this.config.homeserverUrl);
    const transport = parsedUrl.protocol === "https:" ? https : http;
    const bodyStr = body ? JSON.stringify(body) : undefined;

    return new Promise<T>((resolve, reject) => {
      const req = transport.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 8008),
          path,
          method,
          headers: {
            Authorization: `Bearer ${this.config.accessToken}`,
            ...(bodyStr
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(bodyStr),
                }
              : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data) as T);
              } catch {
                resolve(data as unknown as T);
              }
            } else {
              reject(new Error(`Matrix API error ${res.statusCode}: ${data}`));
            }
          });
        },
      );

      req.on("error", (error) => reject(error));

      if (bodyStr) {
        req.write(bodyStr);
      }
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

  private reregisterSessions(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const [roomId, sessionId] of this.sessionMap.entries()) {
      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId,
        payload: {
          channelType: "matrix",
          channelId: roomId,
          metadata: { roomId },
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    }

    if (this.sessionMap.size > 0) {
      this.logger.info({ sessionCount: this.sessionMap.size }, "Re-registered Matrix sessions");
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private findRoomIdBySession(sessionId: string | undefined): string | null {
    if (!sessionId) return null;

    for (const [roomId, sid] of this.sessionMap.entries()) {
      if (sid === sessionId) return roomId;
    }

    return null;
  }

  private async resolveConversationInfo(
    roomId: string,
    senderUserId: string,
  ): Promise<MatrixConversationInfo> {
    const isDirectMessage = await this.detectDirectMessageRoom(roomId);
    const conversation: MatrixConversationInfo = {
      roomId,
      senderUserId,
      isDirectMessage,
      conversationType: isDirectMessage ? "dm" : "room",
    };
    return conversation;
  }

  private async detectDirectMessageRoom(roomId: string): Promise<boolean> {
    const cached = this.roomDirectness.get(roomId);
    if (cached !== undefined) return cached;

    try {
      const response = await this.matrixRequest<{ joined?: Record<string, unknown> }>(
        "GET",
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`,
      );
      const memberCount = Object.keys(response.joined ?? {}).length;
      const isDirectMessage = memberCount > 0 && memberCount <= 2;
      this.roomDirectness.set(roomId, isDirectMessage);
      return isDirectMessage;
    } catch (error) {
      this.logger.warn(
        { error: String(error), roomId },
        "Failed to determine Matrix room type, defaulting to group routing",
      );
      this.roomDirectness.set(roomId, false);
      return false;
    }
  }
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const homeserverUrl = process.env["MATRIX_HOMESERVER_URL"];
  const accessToken = process.env["MATRIX_ACCESS_TOKEN"];
  const userId = process.env["MATRIX_USER_ID"];
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";

  if (!homeserverUrl) {
    process.stderr.write("MATRIX_HOMESERVER_URL environment variable is required\n");
    process.exit(1);
  }

  if (!accessToken) {
    process.stderr.write("MATRIX_ACCESS_TOKEN environment variable is required\n");
    process.exit(1);
  }

  if (!userId) {
    process.stderr.write("MATRIX_USER_ID environment variable is required\n");
    process.exit(1);
  }

  const adapter = new MatrixAdapter({
    homeserverUrl,
    accessToken,
    userId,
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
