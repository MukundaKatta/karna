import express from "express";
import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { randomUUID } from "node:crypto";
import type {
  ProtocolMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  StatusMessage,
  ErrorMessage,
} from "@karna/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Types ──────────────────────────────────────────────────────────────────

interface WebChatConfig {
  gatewayUrl: string;
  port?: number;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

interface ClientSession {
  clientWs: WebSocket;
  sessionId: string;
  clientId: string;
  connectedAt: number;
}

interface PendingStream {
  clientId: string;
  chunks: string[];
}

// ─── WebChatServer ──────────────────────────────────────────────────────────

export class WebChatServer {
  private readonly config: WebChatConfig;
  private readonly logger: pino.Logger;
  private readonly app: express.Application;
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private gatewayWs: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessions = new Map<string, ClientSession>(); // clientId -> session
  private sessionToClient = new Map<string, string>(); // sessionId -> clientId
  private pendingStreams = new Map<string, PendingStream>(); // sessionId -> stream
  private isShuttingDown = false;

  constructor(config: WebChatConfig) {
    this.config = {
      port: 3002,
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:webchat",
      level: process.env["LOG_LEVEL"] ?? "info",
    });

    this.app = express();
    this.setupExpress();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting WebChat server");

    await this.connectToGateway();
    await this.startServer();

    this.logger.info(
      { port: this.config.port },
      "WebChat server started",
    );
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping WebChat server");

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close all client connections
    for (const [, session] of this.sessions) {
      session.clientWs.close(1000, "Server shutting down");
    }
    this.sessions.clear();

    if (this.gatewayWs) {
      this.gatewayWs.close(1000, "Server shutting down");
      this.gatewayWs = null;
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.logger.info("WebChat server stopped");
  }

  // ─── Express Setup ────────────────────────────────────────────────────

  private setupExpress(): void {
    // Serve static UI files
    const uiDir = join(__dirname, "ui");
    this.app.use(express.static(uiDir));

    // Also serve from source directory during development
    const srcUiDir = join(__dirname, "..", "src", "ui");
    this.app.use(express.static(srcUiDir));

    // Health check
    this.app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        channel: "webchat",
        clients: this.sessions.size,
      });
    });

    // Fallback to index.html for SPA
    this.app.get("/", (_req, res) => {
      res.sendFile(join(uiDir, "index.html"), (err) => {
        if (err) {
          // Try source directory
          res.sendFile(join(srcUiDir, "index.html"), (err2) => {
            if (err2) {
              res.status(404).send("Chat UI not found");
            }
          });
        }
      });
    });
  }

  // ─── HTTP + WS Server ────────────────────────────────────────────────

  private async startServer(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.server = createServer(this.app);

      // WebSocket server for browser clients
      this.wss = new WebSocketServer({
        server: this.server,
        path: "/ws",
      });

      this.wss.on("connection", (ws: WebSocket) => {
        this.handleClientConnection(ws);
      });

      this.server.listen(this.config.port, () => {
        this.logger.info(
          { port: this.config.port },
          "HTTP + WebSocket server listening",
        );
        resolve();
      });
    });
  }

  // ─── Client WebSocket Handling ────────────────────────────────────────

  private handleClientConnection(ws: WebSocket): void {
    const clientId = randomUUID();

    this.logger.info({ clientId }, "Browser client connected");

    // Create session with gateway
    const sessionId = randomUUID();
    const session: ClientSession = {
      clientWs: ws,
      sessionId,
      clientId,
      connectedAt: Date.now(),
    };

    this.sessions.set(clientId, session);
    this.sessionToClient.set(sessionId, clientId);

    // Register session with gateway
    if (this.gatewayWs && this.gatewayWs.readyState === WebSocket.OPEN) {
      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "webchat",
          channelId: clientId,
          metadata: { clientId },
        },
      };

      this.gatewayWs.send(JSON.stringify(connectMsg));
    }

    // Send welcome message to client
    this.sendToClient(ws, {
      type: "connected",
      clientId,
      timestamp: Date.now(),
    });

    ws.on("message", (data: Buffer) => {
      this.handleClientMessage(clientId, data);
    });

    ws.on("close", () => {
      this.logger.info({ clientId }, "Browser client disconnected");
      this.sessionToClient.delete(sessionId);
      this.sessions.delete(clientId);
    });

    ws.on("error", (error: Error) => {
      this.logger.error(
        { error: error.message, clientId },
        "Client WebSocket error",
      );
    });
  }

  private handleClientMessage(clientId: string, data: Buffer): void {
    const session = this.sessions.get(clientId);
    if (!session) return;

    let parsed: { type: string; content?: string };
    try {
      parsed = JSON.parse(data.toString()) as { type: string; content?: string };
    } catch {
      this.logger.error({ clientId }, "Failed to parse client message");
      return;
    }

    if (parsed.type === "message" && parsed.content) {
      this.forwardToGateway(session, parsed.content);
    } else if (parsed.type === "ping") {
      this.sendToClient(session.clientWs, {
        type: "pong",
        timestamp: Date.now(),
      });
    }
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private forwardToGateway(session: ClientSession, content: string): void {
    if (!this.gatewayWs || this.gatewayWs.readyState !== WebSocket.OPEN) {
      this.sendToClient(session.clientWs, {
        type: "error",
        message: "Backend is reconnecting. Please try again.",
        timestamp: Date.now(),
      });
      return;
    }

    const chatMessage = {
      id: randomUUID(),
      type: "chat.message" as const,
      timestamp: Date.now(),
      sessionId: session.sessionId,
      payload: {
        content,
        role: "user" as const,
      },
    };

    this.gatewayWs.send(JSON.stringify(chatMessage));
    this.logger.debug(
      { clientId: session.clientId, sessionId: session.sessionId },
      "Forwarded client message to gateway",
    );
  }

  private async connectToGateway(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const wsUrl = this.config.gatewayUrl.replace(/^http/, "ws");

      this.logger.info({ url: wsUrl }, "Connecting to gateway");

      this.gatewayWs = new WebSocket(wsUrl);

      this.gatewayWs.on("open", () => {
        this.logger.info("Connected to gateway");
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        resolve();
      });

      this.gatewayWs.on("message", (data: Buffer) => {
        this.handleGatewayMessage(data);
      });

      this.gatewayWs.on("close", (code: number, reason: Buffer) => {
        this.logger.warn(
          { code, reason: reason.toString() },
          "Gateway connection closed",
        );
        this.stopHeartbeat();

        if (!this.isShuttingDown) {
          this.scheduleReconnect();
        }
      });

      this.gatewayWs.on("error", (error: Error) => {
        this.logger.error({ error: error.message }, "Gateway WebSocket error");

        if (this.reconnectAttempts === 0) {
          reject(new Error(`Failed to connect to gateway: ${error.message}`));
        }
      });
    });
  }

  private handleGatewayMessage(data: Buffer): void {
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
        this.handleAgentResponse(message as AgentResponseMessage);
        break;
      case "agent.response.stream":
        this.handleAgentStreamResponse(message as AgentResponseStreamMessage);
        break;
      case "status":
        this.handleStatusUpdate(message as StatusMessage);
        break;
      case "heartbeat.check":
        this.handleHeartbeatCheck(message);
        break;
      case "error":
        this.handleError(message as ErrorMessage);
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

  private handleAgentResponse(message: AgentResponseMessage): void {
    const clientId = this.sessionToClient.get(message.sessionId ?? "");
    if (!clientId) return;

    const session = this.sessions.get(clientId);
    if (!session) return;

    const content = message.payload.content;
    if (!content) return;

    this.sendToClient(session.clientWs, {
      type: "message",
      content,
      timestamp: Date.now(),
    });
  }

  private handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): void {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const clientId = this.sessionToClient.get(sessionId);
    if (!clientId) return;

    const session = this.sessions.get(clientId);
    if (!session) return;

    // Forward stream deltas directly to the browser client
    this.sendToClient(session.clientWs, {
      type: "stream",
      delta: message.payload.delta,
      finishReason: message.payload.finishReason ?? null,
      timestamp: Date.now(),
    });
  }

  private handleStatusUpdate(message: StatusMessage): void {
    const clientId = this.sessionToClient.get(message.sessionId ?? "");
    if (!clientId) return;

    const session = this.sessions.get(clientId);
    if (!session) return;

    this.sendToClient(session.clientWs, {
      type: "status",
      state: message.payload.state,
      timestamp: Date.now(),
    });
  }

  private handleError(message: ErrorMessage): void {
    const clientId = this.sessionToClient.get(message.sessionId ?? "");
    if (!clientId) return;

    const session = this.sessions.get(clientId);
    if (!session) return;

    this.sendToClient(session.clientWs, {
      type: "error",
      message: message.payload.message,
      code: message.payload.code,
      timestamp: Date.now(),
    });
  }

  private handleHeartbeatCheck(message: ProtocolMessage): void {
    if (!this.gatewayWs || this.gatewayWs.readyState !== WebSocket.OPEN) return;

    const ack: ProtocolMessage = {
      id: randomUUID(),
      type: "heartbeat.ack",
      timestamp: Date.now(),
      sessionId: message.sessionId,
      payload: { clientTime: Date.now() },
    };

    this.gatewayWs.send(JSON.stringify(ack));
  }

  // ─── Client Communication ─────────────────────────────────────────────

  private sendToClient(ws: WebSocket, data: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    try {
      ws.send(JSON.stringify(data));
    } catch (error) {
      this.logger.error({ error }, "Failed to send message to client");
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
      if (this.gatewayWs && this.gatewayWs.readyState === WebSocket.OPEN) {
        this.gatewayWs.ping();
      }
    }, this.config.heartbeatIntervalMs ?? 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";
  const port = parseInt(process.env["WEBCHAT_PORT"] ?? "3002", 10);

  const server = new WebChatServer({ gatewayUrl, port });

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await server.start();
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
