/** WebSocket client for real-time Gateway communication */
import { getBrowserRuntimeConfig } from "./browser-runtime-config";
import { resolvePublicWebSocketUrl } from "./runtime-config";

export type WSMessageHandler = (data: unknown) => void;
export type WSStateHandler = (state: WSState) => void;

export type WSState = "connecting" | "connected" | "disconnected" | "error";

interface WSClientOptions {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  channelId?: string;
}

type PendingChatMessage = {
  content: string;
  attachments?: Array<{ type: string; data?: string; name?: string }>;
};

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string | null;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private heartbeatInterval: number;
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageHandlers = new Set<WSMessageHandler>();
  private stateHandlers = new Set<WSStateHandler>();
  private _state: WSState = "disconnected";
  private sessionId: string | null = null;
  private token: string | null = null;
  private channelId: string;
  private reconnectEnabled = true;
  private configurationError: string | null = null;
  private pendingChatMessages: PendingChatMessage[] = [];

  constructor(options: WSClientOptions = {}) {
    if (options.url) {
      this.url = options.url;
    } else {
      const resolvedWsUrl = resolvePublicWebSocketUrl();
      this.url = resolvedWsUrl.url;
      this.configurationError = this.url || typeof window !== "undefined" ? null : resolvedWsUrl.error;
    }
    this.reconnectInterval = options.reconnectInterval ?? 3000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
    this.channelId = options.channelId ?? `web-${crypto.randomUUID()}`;
  }

  get state(): WSState {
    return this._state;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  get currentChannelId(): string {
    return this.channelId;
  }

  get currentConfigurationError(): string | null {
    return this.configurationError;
  }

  connect(channelId?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    if (channelId) this.channelId = channelId;
    this.reconnectEnabled = true;
    this.setState("connecting");
    void this.openSocket();
  }

  private async openSocket(): Promise<void> {
    if (!this.url) {
      const runtimeConfig = await getBrowserRuntimeConfig();
      this.url = runtimeConfig.webSocketUrl;
      this.configurationError = runtimeConfig.error;
    }

    if (!this.url) {
      this.setState("error");
      return;
    }

    this.configurationError = null;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.send({
        id: crypto.randomUUID(),
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "web",
          channelId: this.channelId,
        },
      });
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        // Handle connect.ack to store session info
        if (data.type === "connect.ack") {
          this.sessionId = data.payload.sessionId;
          if (typeof data.payload.channelId === "string") {
            this.channelId = data.payload.channelId;
          }
          this.token = data.payload.token;
          this.flushPendingChatMessages();
        }
        if (data.type === "connect.challenge") {
          this.pendingChatMessages = [];
          this.configurationError = "Gateway authentication is blocking browser chat for this deployment.";
          this.setState("error");
          return;
        }
        // Handle heartbeat checks
        if (data.type === "heartbeat.check") {
          this.send({
            id: crypto.randomUUID(),
            type: "heartbeat.ack",
            timestamp: Date.now(),
            payload: { clientTime: Date.now() },
          });
          return;
        }
        this.messageHandlers.forEach((handler) => handler(data));
      } catch {
        // Ignore parse errors
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.setState("disconnected");
      if (this.reconnectEnabled) {
        this.attemptReconnect();
      }
    };

    this.ws.onerror = () => {
      this.setState("error");
    };
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.reconnectAttempts = this.maxReconnectAttempts; // prevent reconnect
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.sessionId = null;
    this.token = null;
    this.setState("disconnected");
  }

  selectSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  startNewSession(): void {
    const nextChannelId = `web-${crypto.randomUUID()}`;
    this.pendingChatMessages = [];
    this.disconnect();
    this.reconnectAttempts = 0;
    this.connect(nextChannelId);
  }

  send(data: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(data));
  }

  sendMessage(content: string, attachments?: Array<{ type: string; data?: string; name?: string }>): void {
    if (!this.sessionId) {
      this.pendingChatMessages.push({ content, attachments });
      return;
    }

    this.send({
      id: crypto.randomUUID(),
      type: "chat.message",
      timestamp: Date.now(),
      sessionId: this.sessionId,
      payload: {
        content,
        role: "user",
        attachments,
      },
    });
  }

  sendToolApproval(toolCallId: string, approved: boolean, reason?: string): void {
    this.send({
      id: crypto.randomUUID(),
      type: "tool.approval.response",
      timestamp: Date.now(),
      sessionId: this.sessionId,
      payload: { toolCallId, approved, reason },
    });
  }

  onMessage(handler: WSMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: WSStateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private setState(state: WSState): void {
    this._state = state;
    this.stateHandlers.forEach((handler) => handler(state));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({
          id: crypto.randomUUID(),
          type: "heartbeat.ack",
          timestamp: Date.now(),
          payload: { clientTime: Date.now() },
        });
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, this.reconnectInterval * Math.min(this.reconnectAttempts, 5));
  }

  private flushPendingChatMessages(): void {
    if (!this.sessionId || this.pendingChatMessages.length === 0) {
      return;
    }

    const queuedMessages = [...this.pendingChatMessages];
    this.pendingChatMessages = [];

    for (const message of queuedMessages) {
      this.sendMessage(message.content, message.attachments);
    }
  }
}

/** Singleton instance */
let clientInstance: WSClient | null = null;

export function getWSClient(options?: WSClientOptions): WSClient {
  if (!clientInstance) {
    clientInstance = new WSClient(options);
  }
  return clientInstance;
}
