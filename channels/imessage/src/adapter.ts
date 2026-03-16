import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import Database from "node:sqlite";
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

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────────────────────────────

interface IMessageAdapterConfig {
  gatewayUrl: string;
  pollIntervalMs?: number;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
  chatDbPath?: string;
}

interface PendingResponse {
  handle: string;
  chunks: string[];
  streamComplete: boolean;
}

interface ChatMessage {
  rowid: number;
  text: string;
  handleId: string;
  isFromMe: number;
  date: number;
  service: string;
}

// ─── IMessageAdapter ────────────────────────────────────────────────────────

export class IMessageAdapter {
  private readonly config: IMessageAdapterConfig;
  private readonly logger: pino.Logger;
  private readonly chatDbPath: string;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private sessionMap = new Map<string, string>(); // handle -> sessionId
  private pendingResponses = new Map<string, PendingResponse>();
  private lastProcessedRowId = 0;
  private isShuttingDown = false;
  private db: any = null;

  constructor(config: IMessageAdapterConfig) {
    // Platform check — iMessage is macOS only
    if (platform() !== "darwin") {
      throw new Error(
        "IMessageAdapter is only supported on macOS. " +
          `Current platform: ${platform()}`,
      );
    }

    this.config = {
      pollIntervalMs: 2_000,
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.chatDbPath =
      config.chatDbPath ??
      join(homedir(), "Library", "Messages", "chat.db");

    if (!existsSync(this.chatDbPath)) {
      throw new Error(
        `iMessage database not found at ${this.chatDbPath}. ` +
          "Ensure Full Disk Access is granted to the terminal.",
      );
    }

    this.logger = pino({
      name: "karna:channel:imessage",
      level: process.env["LOG_LEVEL"] ?? "info",
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting iMessage adapter");

    this.openDatabase();
    await this.initializeLastRowId();
    await this.connectToGateway();
    this.startPolling();

    this.logger.info("iMessage adapter started");
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping iMessage adapter");

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

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

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.logger.info("iMessage adapter stopped");
  }

  // ─── Database Access ──────────────────────────────────────────────────

  private openDatabase(): void {
    try {
      // Use sqlite3 command-line tool to query the database
      // since the Messages chat.db requires special permissions
      this.logger.info({ path: this.chatDbPath }, "Opening iMessage database");
    } catch (error) {
      throw new Error(`Failed to open iMessage database: ${error}`);
    }
  }

  private async initializeLastRowId(): Promise<void> {
    try {
      const result = await this.querySqlite(
        "SELECT MAX(ROWID) as maxId FROM message",
      );

      if (result.length > 0 && result[0]?.maxId) {
        this.lastProcessedRowId = parseInt(result[0].maxId, 10);
      }

      this.logger.info(
        { lastRowId: this.lastProcessedRowId },
        "Initialized last processed message ID",
      );
    } catch (error) {
      this.logger.error({ error }, "Failed to initialize last row ID");
      this.lastProcessedRowId = 0;
    }
  }

  /**
   * Query the chat.db using sqlite3 CLI tool.
   * This avoids issues with database locking and permissions.
   */
  private async querySqlite(
    query: string,
  ): Promise<Array<Record<string, string>>> {
    try {
      const { stdout } = await execFileAsync("sqlite3", [
        "-json",
        this.chatDbPath,
        query,
      ]);

      if (!stdout.trim()) return [];

      return JSON.parse(stdout) as Array<Record<string, string>>;
    } catch (error) {
      this.logger.error({ error, query }, "SQLite query failed");
      return [];
    }
  }

  // ─── Polling ──────────────────────────────────────────────────────────

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      void this.pollNewMessages();
    }, this.config.pollIntervalMs ?? 2_000);

    this.logger.info(
      { intervalMs: this.config.pollIntervalMs },
      "Started polling for new messages",
    );
  }

  private async pollNewMessages(): Promise<void> {
    try {
      const query = `
        SELECT
          m.ROWID as rowid,
          m.text as text,
          h.id as handleId,
          m.is_from_me as isFromMe,
          m.date as date,
          m.service as service
        FROM message m
        JOIN handle h ON m.handle_id = h.ROWID
        WHERE m.ROWID > ${this.lastProcessedRowId}
          AND m.is_from_me = 0
          AND m.text IS NOT NULL
          AND m.text != ''
        ORDER BY m.ROWID ASC
        LIMIT 50
      `;

      const messages = await this.querySqlite(query);

      for (const msg of messages) {
        const rowid = parseInt(msg["rowid"] ?? "0", 10);
        const text = msg["text"] ?? "";
        const handleId = msg["handleId"] ?? "";

        if (!text || !handleId) continue;

        this.logger.debug(
          { rowid, handleId, textLength: text.length },
          "New iMessage received",
        );

        await this.forwardToGateway(handleId, text);
        this.lastProcessedRowId = rowid;
      }
    } catch (error) {
      this.logger.error({ error }, "Failed to poll for new messages");
    }
  }

  // ─── Send Message via AppleScript ─────────────────────────────────────

  private async sendIMessage(handle: string, text: string): Promise<void> {
    // Escape single quotes and backslashes for AppleScript
    const escapedText = text
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');

    const script = `
      tell application "Messages"
        set targetService to 1st service whose service type = iMessage
        set targetBuddy to buddy "${handle}" of targetService
        send "${escapedText}" to targetBuddy
      end tell
    `;

    try {
      await execFileAsync("osascript", ["-e", script]);
      this.logger.debug({ handle, textLength: text.length }, "iMessage sent");
    } catch (error) {
      this.logger.error({ error, handle }, "Failed to send iMessage via AppleScript");

      // Fallback: try sending as SMS if iMessage fails
      try {
        const smsScript = `
          tell application "Messages"
            set targetService to 1st service whose service type = SMS
            set targetBuddy to buddy "${handle}" of targetService
            send "${escapedText}" to targetBuddy
          end tell
        `;
        await execFileAsync("osascript", ["-e", smsScript]);
        this.logger.debug({ handle }, "Fell back to SMS successfully");
      } catch (smsError) {
        this.logger.error({ error: smsError, handle }, "SMS fallback also failed");
      }
    }
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private async forwardToGateway(
    handle: string,
    content: string,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn({ handle }, "Gateway not connected, cannot forward message");
      return;
    }

    let sessionId = this.sessionMap.get(handle);

    if (!sessionId) {
      sessionId = randomUUID();
      this.sessionMap.set(handle, sessionId);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "imessage",
          channelId: handle,
          metadata: { handle },
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
      },
    };

    this.ws.send(JSON.stringify(chatMessage));
    this.logger.debug({ handle, sessionId }, "Forwarded message to gateway");
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
        // iMessage has no typing indicator API
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
    const handle = this.findHandleBySession(message.sessionId);
    if (!handle) {
      this.logger.warn({ sessionId: message.sessionId }, "No handle found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    await this.sendIMessage(handle, content);
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const handle = this.findHandleBySession(sessionId);
    if (!handle) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = { handle, chunks: [], streamComplete: false };
      this.pendingResponses.set(sessionId, pending);
    }

    pending.chunks.push(message.payload.delta);

    if (message.payload.finishReason) {
      pending.streamComplete = true;
      const fullContent = pending.chunks.join("");
      this.pendingResponses.delete(sessionId);

      await this.sendIMessage(handle, fullContent);
    }
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const handle = this.findHandleBySession(message.sessionId);
    if (!handle) return;

    const { code, message: errorMsg } = message.payload;
    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    await this.sendIMessage(handle, `Error: ${errorMsg}. Please try again.`);
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

  private findHandleBySession(sessionId: string | undefined): string | null {
    if (!sessionId) return null;

    for (const [handle, sid] of this.sessionMap.entries()) {
      if (sid === sessionId) return handle;
    }

    return null;
  }

  resetSession(handle: string): void {
    this.sessionMap.delete(handle);
    this.logger.info({ handle }, "Session reset");
  }
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";

  if (platform() !== "darwin") {
    console.error("iMessage adapter is only supported on macOS");
    process.exit(1);
  }

  const adapter = new IMessageAdapter({ gatewayUrl });

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
