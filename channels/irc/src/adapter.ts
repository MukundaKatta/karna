import WebSocket from "ws";
import pino from "pino";
import { randomUUID } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import type {
  ProtocolMessage,
  AgentResponseMessage,
  AgentResponseStreamMessage,
  ToolApprovalRequestedMessage,
  StatusMessage,
  ErrorMessage,
} from "@karna/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

interface IrcAdapterConfig {
  /** IRC server hostname */
  server: string;
  /** IRC server port */
  port: number;
  /** Bot nickname */
  nick: string;
  /** IRC channels to join (e.g. ["#general", "#dev"]) */
  channels: string[];
  /** Use TLS/SSL */
  useTls?: boolean;
  /** IRC server password (optional) */
  serverPassword?: string;
  /** NickServ password (optional) */
  nickServPassword?: string;
  gatewayUrl: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

interface IrcMessage {
  prefix: string | null;
  command: string;
  params: string[];
}

interface PendingResponse {
  target: string;
  chunks: string[];
  streamComplete: boolean;
}

// ─── IrcAdapter ─────────────────────────────────────────────────────────────

export class IrcAdapter {
  private readonly config: IrcAdapterConfig;
  private readonly logger: pino.Logger;
  private ws: WebSocket | null = null;
  private ircSocket: net.Socket | tls.TLSSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private ircReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionMap = new Map<string, string>(); // nick!channel -> sessionId
  private pendingResponses = new Map<string, PendingResponse>(); // sessionId -> pending
  private isShuttingDown = false;
  private ircBuffer = "";
  private registered = false;

  constructor(config: IrcAdapterConfig) {
    this.config = {
      useTls: false,
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:irc",
      level: process.env["LOG_LEVEL"] ?? "info",
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting IRC adapter");

    await this.connectToGateway();
    this.connectToIrc();

    this.logger.info("IRC adapter started");
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping IRC adapter");

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ircReconnectTimer) {
      clearTimeout(this.ircReconnectTimer);
      this.ircReconnectTimer = null;
    }

    if (this.ircSocket) {
      this.ircSend("QUIT :Adapter shutting down");
      this.ircSocket.destroy();
      this.ircSocket = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Adapter shutting down");
      this.ws = null;
    }

    this.logger.info("IRC adapter stopped");
  }

  // ─── IRC Connection ────────────────────────────────────────────────────

  private connectToIrc(): void {
    const { server, port, useTls } = this.config;

    this.logger.info({ server, port, useTls }, "Connecting to IRC server");

    this.registered = false;
    this.ircBuffer = "";

    if (useTls) {
      this.ircSocket = tls.connect({ host: server, port, rejectUnauthorized: false }, () => {
        this.logger.info("TLS connection established to IRC server");
        this.registerIrc();
      });
    } else {
      this.ircSocket = net.createConnection({ host: server, port }, () => {
        this.logger.info("TCP connection established to IRC server");
        this.registerIrc();
      });
    }

    this.ircSocket.setEncoding("utf-8");

    this.ircSocket.on("data", (data: string) => {
      this.ircBuffer += data;
      const lines = this.ircBuffer.split("\r\n");
      this.ircBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.length > 0) {
          this.handleIrcLine(line);
        }
      }
    });

    this.ircSocket.on("close", () => {
      this.logger.warn("IRC connection closed");
      this.registered = false;

      if (!this.isShuttingDown) {
        this.ircReconnectTimer = setTimeout(() => this.connectToIrc(), 5_000);
      }
    });

    this.ircSocket.on("error", (error: Error) => {
      this.logger.error({ error: error.message }, "IRC socket error");
    });
  }

  private registerIrc(): void {
    if (this.config.serverPassword) {
      this.ircSend(`PASS ${this.config.serverPassword}`);
    }
    this.ircSend(`NICK ${this.config.nick}`);
    this.ircSend(`USER ${this.config.nick} 0 * :Karna Bot`);
  }

  private ircSend(line: string): void {
    if (this.ircSocket && !this.ircSocket.destroyed) {
      this.ircSocket.write(`${line}\r\n`);
    }
  }

  private handleIrcLine(line: string): void {
    const parsed = this.parseIrcMessage(line);
    if (!parsed) return;

    switch (parsed.command) {
      case "PING":
        this.ircSend(`PONG :${parsed.params[0] ?? ""}`);
        break;

      case "001": // RPL_WELCOME
        this.registered = true;
        this.logger.info("IRC registration complete");

        // Identify with NickServ if configured
        if (this.config.nickServPassword) {
          this.ircSend(`PRIVMSG NickServ :IDENTIFY ${this.config.nickServPassword}`);
        }

        // Join configured channels
        for (const channel of this.config.channels) {
          this.ircSend(`JOIN ${channel}`);
          this.logger.info({ channel }, "Joining IRC channel");
        }
        break;

      case "PRIVMSG":
        this.handlePrivmsg(parsed);
        break;

      case "433": // ERR_NICKNAMEINUSE
        this.logger.warn("Nickname in use, appending underscore");
        this.config.nick = this.config.nick + "_";
        this.ircSend(`NICK ${this.config.nick}`);
        break;

      default:
        this.logger.debug({ command: parsed.command }, "IRC message");
    }
  }

  private parseIrcMessage(raw: string): IrcMessage | null {
    let prefix: string | null = null;
    let rest = raw;

    if (rest.startsWith(":")) {
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx === -1) return null;
      prefix = rest.substring(1, spaceIdx);
      rest = rest.substring(spaceIdx + 1);
    }

    const params: string[] = [];
    while (rest.length > 0) {
      if (rest.startsWith(":")) {
        params.push(rest.substring(1));
        break;
      }
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx === -1) {
        params.push(rest);
        break;
      }
      params.push(rest.substring(0, spaceIdx));
      rest = rest.substring(spaceIdx + 1);
    }

    const command = params.shift() ?? "";
    return { prefix, command, params };
  }

  private handlePrivmsg(message: IrcMessage): void {
    if (!message.prefix) return;

    const nick = message.prefix.split("!")[0];
    if (!nick || nick === this.config.nick) return;

    const target = message.params[0]; // channel or nick
    const text = message.params[1];
    if (!target || !text) return;

    // Determine if this is a channel message or DM
    const isChannel = target.startsWith("#") || target.startsWith("&");
    const replyTarget = isChannel ? target : nick;

    // For channel messages, only respond when mentioned
    if (isChannel) {
      const mentioned =
        text.toLowerCase().includes(this.config.nick.toLowerCase()) ||
        text.startsWith("!") ||
        text.startsWith(`${this.config.nick}:`);

      if (!mentioned) return;
    }

    const cleanText = text
      .replace(new RegExp(`^${this.config.nick}[:\\s,]+`, "i"), "")
      .replace(/^!\s*/, "")
      .trim();

    if (!cleanText) return;

    this.logger.debug(
      { nick, target: replyTarget, textLength: cleanText.length },
      "Received IRC message",
    );

    const sessionKey = `${nick}!${replyTarget}`;
    void this.forwardToGateway(sessionKey, cleanText, replyTarget, nick, !isChannel, isChannel);
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private async forwardToGateway(
    sessionKey: string,
    content: string,
    replyTarget: string,
    userId: string,
    isDirectMessage: boolean,
    agentMentioned: boolean,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn({ sessionKey }, "Gateway not connected, cannot forward message");
      return;
    }

    let sessionId = this.sessionMap.get(sessionKey);

    if (!sessionId) {
      sessionId = randomUUID();
      this.sessionMap.set(sessionKey, sessionId);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "irc",
          channelId: sessionKey,
          metadata: {
            replyTarget,
            server: this.config.server,
            userId,
            isDirectMessage,
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
          senderUserId: userId,
          isDirectMessage,
          agentMentioned,
        },
      },
    };

    this.ws.send(JSON.stringify(chatMessage));
    this.logger.debug({ sessionKey, sessionId }, "Forwarded message to gateway");
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

    for (const [sessionKey, sid] of this.sessionMap.entries()) {
      if (sid === message.sessionId || !this.sessionMap.has(sessionKey)) {
        this.sessionMap.set(sessionKey, sessionId);
        break;
      }
    }
  }

  private async handleAgentResponse(message: AgentResponseMessage): Promise<void> {
    const target = this.findTargetBySession(message.sessionId);
    if (!target) {
      this.logger.warn({ sessionId: message.sessionId }, "No target found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    await this.sendToChannel(target, content);
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const target = this.findTargetBySession(sessionId);
    if (!target) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = { target, chunks: [], streamComplete: false };
      this.pendingResponses.set(sessionId, pending);
    }

    pending.chunks.push(message.payload.delta);

    if (message.payload.finishReason) {
      pending.streamComplete = true;
      const fullContent = pending.chunks.join("");
      this.pendingResponses.delete(sessionId);

      await this.sendToChannel(target, fullContent);
    }
  }

  private async handleToolApprovalRequest(
    message: ToolApprovalRequestedMessage,
  ): Promise<void> {
    const target = this.findTargetBySession(message.sessionId);
    if (!target) return;

    const { toolName, description, riskLevel, toolCallId } = message.payload;

    const text = [
      `[Tool Approval Required]`,
      `Tool: ${toolName}`,
      `Risk: ${riskLevel}`,
      description ? `Description: ${description}` : "",
      `Reply "approve" or "deny"`,
    ]
      .filter(Boolean)
      .join(" | ");

    await this.sendToChannel(target, text);

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
    // IRC does not support typing indicators
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const target = this.findTargetBySession(message.sessionId);
    if (!target) return;

    const { code, message: errorMsg } = message.payload;

    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    await this.sendToChannel(target, `Error: ${errorMsg} — Please try again.`);
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

  // ─── IRC Message Sending ───────────────────────────────────────────────

  private async sendToChannel(target: string, text: string): Promise<void> {
    // IRC has a ~512 byte line limit; split long messages
    const maxLineLen = 400;
    const lines = text.split("\n");

    for (const line of lines) {
      if (line.length === 0) continue;

      if (line.length <= maxLineLen) {
        this.ircSend(`PRIVMSG ${target} :${line}`);
      } else {
        // Split long lines
        for (let i = 0; i < line.length; i += maxLineLen) {
          const chunk = line.substring(i, i + maxLineLen);
          this.ircSend(`PRIVMSG ${target} :${chunk}`);
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

  private findTargetBySession(sessionId: string | undefined): string | null {
    if (!sessionId) return null;

    for (const [sessionKey, sid] of this.sessionMap.entries()) {
      if (sid === sessionId) {
        // sessionKey is "nick!target", extract the target (channel or nick for DM)
        const parts = sessionKey.split("!");
        return parts[1] ?? null;
      }
    }

    return null;
  }
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const server = process.env["IRC_SERVER"];
  const port = process.env["IRC_PORT"] ? parseInt(process.env["IRC_PORT"], 10) : 6667;
  const nick = process.env["IRC_NICK"] ?? "karna-bot";
  const channels = process.env["IRC_CHANNELS"]?.split(",").map((c) => c.trim()) ?? ["#general"];
  const useTls = process.env["IRC_USE_TLS"] === "true";
  const serverPassword = process.env["IRC_SERVER_PASSWORD"];
  const nickServPassword = process.env["IRC_NICKSERV_PASSWORD"];
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";

  if (!server) {
    process.stderr.write("IRC_SERVER environment variable is required\n");
    process.exit(1);
  }

  const adapter = new IrcAdapter({
    server,
    port,
    nick,
    channels,
    useTls,
    serverPassword,
    nickServPassword,
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
