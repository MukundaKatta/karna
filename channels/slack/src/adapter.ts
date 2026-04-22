import { App } from "@slack/bolt";
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

interface SlackAdapterConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
  gatewayUrl: string;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
  heartbeatIntervalMs?: number;
}

interface PendingResponse {
  channel: string;
  threadTs?: string;
  chunks: string[];
  streamComplete: boolean;
}

interface SessionInfo {
  sessionId: string;
  threadTs?: string;
}

// ─── SlackAdapter ───────────────────────────────────────────────────────────

export class SlackAdapter {
  private readonly app: App;
  private readonly config: SlackAdapterConfig;
  private readonly logger: pino.Logger;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sessionMap = new Map<string, SessionInfo>(); // channelId:threadTs -> session
  private pendingResponses = new Map<string, PendingResponse>();
  private isShuttingDown = false;

  constructor(config: SlackAdapterConfig) {
    this.config = {
      reconnectIntervalMs: 5_000,
      maxReconnectAttempts: 20,
      heartbeatIntervalMs: 30_000,
      ...config,
    };

    this.logger = pino({
      name: "karna:channel:slack",
      level: process.env["LOG_LEVEL"] ?? "info",
    });

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
      logger: {
        debug: (...msgs) => this.logger.debug(msgs.join(" ")),
        info: (...msgs) => this.logger.info(msgs.join(" ")),
        warn: (...msgs) => this.logger.warn(msgs.join(" ")),
        error: (...msgs) => this.logger.error(msgs.join(" ")),
        getLevel: () => this.logger.level as any,
        setLevel: () => {},
        setName: () => {},
      },
    });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info("Starting Slack adapter");

    this.setupEventHandlers();
    await this.connectToGateway();
    await this.app.start();

    this.logger.info("Slack adapter started");
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info("Stopping Slack adapter");

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

    await this.app.stop();
    this.logger.info("Slack adapter stopped");
  }

  // ─── Event Handlers ───────────────────────────────────────────────────

  private setupEventHandlers(): void {
    // Handle direct messages
    this.app.message(async ({ message, say }) => {
      const msg = message as any;

      // Ignore bot messages and subtypes (edits, deletes, etc.)
      if (msg.subtype) return;
      if (!("text" in msg) || !msg.text) return;
      if (msg.channel_type !== "im" && msg.channel_type !== "mpim") return;

      const channel = msg.channel;
      const threadTs = msg.thread_ts ?? msg.ts;
      const text = msg.text;

      this.logger.debug(
        { channel, threadTs, textLength: text.length },
        "Received direct message",
      );

      // Handle file attachments
      const attachments: Array<{ type: string; url?: string; name?: string }> = [];
      if (msg.files) {
        for (const file of msg.files) {
          const type = file.mimetype.startsWith("image/")
            ? "image"
            : file.mimetype.startsWith("video/")
              ? "video"
              : file.mimetype.startsWith("audio/")
                ? "audio"
                : "document";

          attachments.push({
            type,
            url: file.url_private,
            name: file.name,
          });
        }
      }

      await this.forwardToGateway(
        channel,
        text,
        threadTs,
        {
          userId: msg.user,
          isDirectMessage: true,
          agentMentioned: false,
        },
        attachments.length > 0 ? attachments : undefined,
      );
    });

    // Handle app mentions in channels
    this.app.event("app_mention", async ({ event }) => {
      const mentionEvent = event as any;
      const channel = mentionEvent.channel;
      const threadTs = mentionEvent.thread_ts ?? mentionEvent.ts;

      // Remove bot mention from text
      let text = mentionEvent.text.replace(/<@[A-Z0-9]+>/g, "").trim();

      if (!text) {
        text = "Hello!";
      }

      this.logger.debug(
        { channel, threadTs, textLength: text.length },
        "Received app mention",
      );

      await this.forwardToGateway(channel, text, threadTs, {
        userId: mentionEvent.user,
        isDirectMessage: false,
        agentMentioned: true,
      });
    });
  }

  // ─── Gateway Communication ─────────────────────────────────────────────

  private async forwardToGateway(
    channel: string,
    content: string,
    threadTs?: string,
    routing?: { userId?: string; isDirectMessage: boolean; agentMentioned: boolean },
    attachments?: Array<{ type: string; url?: string; data?: string; name?: string }>,
  ): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn({ channel }, "Gateway not connected, cannot forward message");
      try {
        await this.app.client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: "I'm currently reconnecting to my backend. Please try again in a moment.",
        });
      } catch {
        // Swallow send errors during reconnection
      }
      return;
    }

    const sessionKey = `${channel}:${threadTs ?? "root"}`;
    let session = this.sessionMap.get(sessionKey);

    if (!session) {
      const sessionId = randomUUID();
      session = { sessionId, threadTs };
      this.sessionMap.set(sessionKey, session);

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId,
        payload: {
          channelType: "slack",
          channelId: channel,
          metadata: {
            channel,
            threadTs,
            userId: routing?.userId,
            isDirectMessage: routing?.isDirectMessage,
          },
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    }

    const payload: Record<string, unknown> = {
      content,
      role: "user" as const,
      metadata: {
        senderUserId: routing?.userId,
        isDirectMessage: routing?.isDirectMessage,
        agentMentioned: routing?.agentMentioned,
      },
    };
    if (attachments && attachments.length > 0) {
      payload["attachments"] = attachments;
    }

    const chatMessage = {
      id: randomUUID(),
      type: "chat.message" as const,
      timestamp: Date.now(),
      sessionId: session.sessionId,
      payload,
    };

    this.ws.send(JSON.stringify(chatMessage));
    this.logger.debug({ channel, sessionId: session.sessionId }, "Forwarded message to gateway");
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
    const sessionInfo = this.findSessionInfoById(message.sessionId);
    if (!sessionInfo) {
      this.logger.warn({ sessionId: message.sessionId }, "No channel found for session");
      return;
    }

    const content = message.payload.content;
    if (!content) return;

    const { channel, threadTs } = sessionInfo;
    await this.sendSlackMessage(channel, content, threadTs);
  }

  private async handleAgentStreamResponse(
    message: AgentResponseStreamMessage,
  ): Promise<void> {
    const sessionId = message.sessionId;
    if (!sessionId) return;

    const sessionInfo = this.findSessionInfoById(sessionId);
    if (!sessionInfo) return;

    let pending = this.pendingResponses.get(sessionId);
    if (!pending) {
      pending = {
        channel: sessionInfo.channel,
        threadTs: sessionInfo.threadTs,
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

      await this.sendSlackMessage(
        pending.channel,
        fullContent,
        pending.threadTs,
      );
    }
  }

  private async handleStatusUpdate(message: StatusMessage): Promise<void> {
    // Slack doesn't have a native typing indicator via bot API
    // We could update a message with "..." but that's noisy
    // So we just log it
    this.logger.debug(
      { sessionId: message.sessionId, state: message.payload.state },
      "Status update received",
    );
  }

  private async handleError(message: ErrorMessage): Promise<void> {
    const sessionInfo = this.findSessionInfoById(message.sessionId);
    if (!sessionInfo) return;

    const { code, message: errorMsg } = message.payload;
    this.logger.error({ code, errorMsg, sessionId: message.sessionId }, "Gateway error");

    const blocks: any[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:warning: *Error*\n${errorMsg}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Error code: \`${code}\` | Please try again.`,
          },
        ],
      },
    ];

    try {
      await this.app.client.chat.postMessage({
        channel: sessionInfo.channel,
        thread_ts: sessionInfo.threadTs,
        blocks,
        text: `Error: ${errorMsg}`,
      });
    } catch (error) {
      this.logger.error({ error }, "Failed to send error message to Slack");
    }
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

  // ─── Slack Messaging ──────────────────────────────────────────────────

  private async sendSlackMessage(
    channel: string,
    content: string,
    threadTs?: string,
  ): Promise<void> {
    try {
      // Build Block Kit message for rich formatting
      const blocks = this.buildBlocks(content);

      await this.app.client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        blocks,
        text: content, // Fallback for notifications
      });
    } catch (error) {
      this.logger.error({ error, channel }, "Failed to send Slack message");

      // Fallback to plain text
      try {
        await this.app.client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: content,
        });
      } catch (fallbackError) {
        this.logger.error({ error: fallbackError, channel }, "Fallback send also failed");
      }
    }
  }

  /**
   * Build Slack Block Kit blocks from markdown content.
   * Supports code blocks, sections, and dividers.
   */
  private buildBlocks(content: string): any[] {
    const blocks: any[] = [];
    const segments = content.split(/```(\w*)\n?([\s\S]*?)```/g);

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment === undefined || segment === "") continue;

      // Every 3rd group (index 2, 5, 8...) from the regex is code content
      // Every 3rd group - 1 (index 1, 4, 7...) is the language
      if (i % 3 === 2) {
        // Code block content
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\`\`\`${segment}\`\`\``,
          },
        });
      } else if (i % 3 === 0 && segment.trim()) {
        // Regular text - split into chunks of max 3000 chars (Slack block limit)
        const textChunks = splitText(segment.trim(), 3000);
        for (const chunk of textChunks) {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: chunk,
            },
          });
        }
      }
      // i % 3 === 1 is the language identifier — skip
    }

    if (blocks.length === 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: content.slice(0, 3000),
        },
      });
    }

    return blocks;
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

  private reregisterSessions(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const [sessionKey, session] of this.sessionMap.entries()) {
      const [channel] = sessionKey.split(":");
      if (!channel) continue;

      const connectMsg: ProtocolMessage = {
        id: randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        sessionId: session.sessionId,
        payload: {
          channelType: "slack",
          channelId: channel,
          metadata: {
            channel,
            threadTs: session.threadTs,
          },
        },
      };

      this.ws.send(JSON.stringify(connectMsg));
    }

    if (this.sessionMap.size > 0) {
      this.logger.info({ sessionCount: this.sessionMap.size }, "Re-registered Slack sessions");
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private findSessionInfoById(
    sessionId: string | undefined,
  ): { channel: string; threadTs?: string } | null {
    if (!sessionId) return null;

    for (const [key, session] of this.sessionMap.entries()) {
      if (session.sessionId === sessionId) {
        const channel = key.split(":")[0]!;
        return { channel, threadTs: session.threadTs };
      }
    }

    return null;
  }

  resetSession(channel: string, threadTs?: string): void {
    const sessionKey = `${channel}:${threadTs ?? "root"}`;
    this.sessionMap.delete(sessionKey);
    this.logger.info({ channel, threadTs }, "Session reset");
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n", maxLen);
    if (splitIndex <= maxLen * 0.3) {
      splitIndex = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIndex <= 0) {
      splitIndex = maxLen;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

// ─── Standalone Entry Point ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const botToken = process.env["SLACK_BOT_TOKEN"];
  const appToken = process.env["SLACK_APP_TOKEN"];
  const signingSecret = process.env["SLACK_SIGNING_SECRET"];
  const gatewayUrl = process.env["KARNA_GATEWAY_URL"] ?? "ws://localhost:3000/ws";

  if (!botToken) {
    process.stderr.write("SLACK_BOT_TOKEN environment variable is required" + "\n");
    process.exit(1);
  }

  if (!appToken) {
    process.stderr.write("SLACK_APP_TOKEN environment variable is required" + "\n");
    process.exit(1);
  }

  if (!signingSecret) {
    process.stderr.write("SLACK_SIGNING_SECRET environment variable is required" + "\n");
    process.exit(1);
  }

  const adapter = new SlackAdapter({
    botToken,
    appToken,
    signingSecret,
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

const isMainModule =
  typeof import.meta.url === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  main().catch((error) => {
    process.stderr.write(`Fatal error: ${String(error)}\n`);
    process.exit(1);
  });
}
