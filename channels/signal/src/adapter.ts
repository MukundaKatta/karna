import WebSocket from "ws";
import pino from "pino";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type {
  ProtocolMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  ToolApprovalRequestedMessage,
  StatusMessage,
  ErrorMessage,
} from "@karna/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SignalAdapterConfig {
  /** URL of the signal-cli REST API (e.g. http://localhost:8080) */
  signalApiUrl: string;
  /** The registered Signal phone number (e.g. +1234567890) */
  signalNumber: string;
  gatewayUrl: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

interface SignalMessage {
  envelope: {
    source: string;
    sourceNumber: string;
    sourceDevice: number;
    timestamp: number;
    dataMessage?: {
      message: string;
      timestamp: number;
      attachments?: Array<{
        contentType: string;
        filename: string;
        id: string;
        size: number;
      }>;
    };
  };
}

interface PendingResponse {
  recipientNumber: string;
  chunks: string[];
  streamComplete: boolean;
}

// ─── SignalAdapter ──────────────────────────────────────────────────────────

export class SignalAdapter {
  private readonly config: SignalAdapterConfig;
  private readonly logger: pino.Logger;
  private ws: WebSocket | null = null;
  private signalWs: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessionMap = new Map<string, string>(); // phoneNumber -> sessionId
  private pendingResponses = new Map<string, PendingResponse>(); // sessionId -> pending
  private isShuttingDown = false;

  constructor(config: SignalAdapterConfig) {
    this.config = {
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:signal",
      level: process.env["LOG_LEVEL"] ?? "info",
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting Signal adapter");

    await this.connectToGateway();
    this.connectToSignalApi();

    this.logger.info("Signal adapter started");
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping Signal adapter");

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.signalWs) {
      this.signalWs.close(1000, "Adapter shutting down");
      this.signalWs = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Adapter shutting down");
      this.ws = null;
    }

    this.logger.info("Signal adapter stopped");
  }

  // ─── Signal API Connection ────────────────────────────────────────────

  private connectToSignalApi(): void {
    const wsUrl = this.config.signalApiUrl.replace(/^http/, "ws") + `/v1/receive/${this.config.signalNumber}`;

    this.logger.info({ url: wsUrl }, "Connecting to signal-cli REST API");

    this.signalWs = new WebSocket(wsUrl);

    this.signalWs.on("open", () => {
      this.logger.info("Connected to signal-cli REST API");
    });

    this.signalWs.on("message", (data: WebSocket.RawData) => {
      this.handleSignalMessage(data);
    });

    this.signalWs.on("close", (code: number, reason: Buffer) => {
      this.logger.warn(
        { code, reason: reason.toString() },
        "Signal API connection closed",
      );
      if (!this.isShuttingDown) {
        setTimeout(() => this.connectToSignalApi(), 5_000);
      }
    });

    this.signalWs.on("error", (error: Error) => {
      this.logger.error({ error: error.message }, "Signal API WebSocket error");
    });
  }

  private handleSignalMessage(data: WebSocket.RawData): void {
    let message: SignalMessage;
    try {
      message = JSON.parse(data.toString()) as SignalMessage;
    } catch {
      this.logger.error("Failed to parse Signal message");
      return;
    }

    const envelope = message.envelope;
    if (!envelope?.dataMessage?.message) return;

    const senderNumber = envelope.sourceNumber ?? envelope.source;
    const text = envelope.dataMessage.message;

    this.logger.debug({ senderNumber, textLength: text.length }, "Received Signal message");

    void this.forwardToGateway(senderNumber, text);
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private async forwardToGateway(
    senderNumber: string,
    content: string,
    attachments?: Array<{ type: string; url?: string; data?: string; name?: string }>,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn({ senderNumber }, "Gateway not connected, cannot forward message");
      return;
    }

    let sessionId = this.sessionMap.get(senderNumber);

    if (!sessionId) {
      sessionId = randomUUID();
      this.sessionMap.set(senderNumber, sessionId);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "signal",
          channelId: senderNumber,
          metadata: { phoneNumber: senderNumber },
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
    this.logger.debug({ senderNumber, sessionId }, "Forwarded message to gateway");
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

    for (const [phoneNumber, sid] of this.sessionMap.entries()) {
      if (sid === message.sessionId || !this.sessionMap.has(phoneNumber)) {
        this.sessionMap.set(phoneNumber, sessionId);
        break;
      }
    }
  }

  private async handleAgentResponse(message: AgentResponseMessage): Promise<void> {
    const recipientNumber = this.findRecipientBySession(message.sessionId);
    if (!recipientNumber) {
      this.logger.warn({ sessionId: message.sessionId }, "No recipient found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    await this.sendSignalMessage(recipientNumber, content);
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const recipientNumber = this.findRecipientBySession(sessionId);
    if (!recipientNumber) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = { recipientNumber, chunks: [], streamComplete: false };
      this.pendingResponses.set(sessionId, pending);
    }

    pending.chunks.push(message.payload.delta);

    if (message.payload.finishReason) {
      pending.streamComplete = true;
      const fullContent = pending.chunks.join("");
      this.pendingResponses.delete(sessionId);

      await this.sendSignalMessage(recipientNumber, fullContent);
    }
  }

  private async handleToolApprovalRequest(
    message: ToolApprovalRequestedMessage,
  ): Promise<void> {
    const recipientNumber = this.findRecipientBySession(message.sessionId);
    if (!recipientNumber) return;

    const { toolName, description, riskLevel, toolCallId } = message.payload;

    const text = [
      `Tool Approval Required`,
      ``,
      `Tool: ${toolName}`,
      `Risk: ${riskLevel}`,
      description ? `Description: ${description}` : "",
      ``,
      `Reply "approve" or "deny"`,
    ]
      .filter(Boolean)
      .join("\n");

    await this.sendSignalMessage(recipientNumber, text);

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
    // Signal does not support typing indicators via the REST API
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const recipientNumber = this.findRecipientBySession(message.sessionId);
    if (!recipientNumber) return;

    const { code, message: errorMsg } = message.payload;

    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    await this.sendSignalMessage(
      recipientNumber,
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

  // ─── Signal Message Sending ────────────────────────────────────────────

  private async sendSignalMessage(recipientNumber: string, text: string): Promise<void> {
    const url = `${this.config.signalApiUrl}/v2/send`;
    const body = JSON.stringify({
      message: text,
      number: this.config.signalNumber,
      recipients: [recipientNumber],
    });

    return new Promise<void>((resolve, reject) => {
      const parsedUrl = new URL(url);
      const req = http.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: "POST",
          headers: {
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
              { statusCode: res.statusCode, recipientNumber },
              "Failed to send Signal message",
            );
            res.resume();
            resolve(); // Don't reject, just log
          }
        },
      );

      req.on("error", (error) => {
        this.logger.error({ error: error.message, recipientNumber }, "Signal send error");
        resolve(); // Don't reject, just log
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

  private findRecipientBySession(sessionId: string | undefined): string | null {
    if (!sessionId) return null;

    for (const [phoneNumber, sid] of this.sessionMap.entries()) {
      if (sid === sessionId) return phoneNumber;
    }

    return null;
  }
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const signalApiUrl = process.env["SIGNAL_API_URL"] ?? "http://localhost:8080";
  const signalNumber = process.env["SIGNAL_NUMBER"];
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";

  if (!signalNumber) {
    process.stderr.write("SIGNAL_NUMBER environment variable is required\n");
    process.exit(1);
  }

  const adapter = new SignalAdapter({ signalApiUrl, signalNumber, gatewayUrl });

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
