import { useAppStore } from "./store";
import type {
  ChatMessage,
  ToolCall,
  MemoryEntry,
  Skill,
  Reminder,
} from "./store";
import { readAudioFileAsBase64, playAudioResponse } from "./voice";
import {
  deriveMobileGatewayHealthUrl,
  normalizeMobileGatewayWsUrl,
} from "./runtime-config";

// ── Protocol Types ───────────────────────────────────────────────────────────

interface ProtocolMessage {
  type: string;
  id?: string;
  timestamp?: number;
  sessionId?: string;
  payload?: Record<string, unknown>;
}

type MessageHandler = (message: ProtocolMessage) => void;

// ── Gateway Client ───────────────────────────────────────────────────────────

class GatewayClient {
  private ws: WebSocket | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url = "";
  private token = "";
  private intentionalClose = false;
  private sessionId: string | null = null;
  private pendingStreamMessageId: string | null = null;
  private channelId = `mobile-${generateId()}`;

  connect(url: string, token: string): void {
    this.url = normalizeMobileGatewayWsUrl(url);
    this.token = token;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    void this.establishConnection();
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this.sessionId = null;
    this.pendingStreamMessageId = null;
    useAppStore.getState().setStatus("disconnected");
  }

  send(message: ProtocolMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[GatewayClient] Cannot send: WebSocket not open");
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  sendChatMessage(content: string): void {
    const store = useAppStore.getState();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionId) {
      console.warn(
        "[GatewayClient] Cannot send chat: gateway session is not ready",
      );
      store.setTyping(false);
      store.setStatus(
        this.ws?.readyState === WebSocket.OPEN ? "connecting" : "disconnected",
      );
      this.addSystemMessage(
        "Karna is still connecting to the gateway. Please wait for the connection to finish, then try again.",
      );
      return;
    }

    const id = generateId();
    const userMessage: ChatMessage = {
      id,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    store.addMessage(userMessage);
    store.setTyping(true);

    this.send({
      id,
      type: "chat.message",
      timestamp: Date.now(),
      sessionId: this.sessionId ?? undefined,
      payload: { content, role: "user" },
    });
  }

  async sendVoiceMessage(audioUri: string): Promise<void> {
    const base64 = await readAudioFileAsBase64(audioUri);
    const chunkSize = 32_000;

    this.send({
      id: generateId(),
      type: "voice.start",
      timestamp: Date.now(),
      sessionId: this.sessionId ?? undefined,
      payload: { mode: "push-to-talk" },
    });

    for (let offset = 0; offset < base64.length; offset += chunkSize) {
      this.send({
        id: generateId(),
        type: "voice.audio.chunk",
        timestamp: Date.now(),
        sessionId: this.sessionId ?? undefined,
        payload: {
          data: base64.slice(offset, offset + chunkSize),
          format: "m4a",
          sampleRate: 44100,
        },
      });
    }

    this.send({
      id: generateId(),
      type: "voice.end",
      timestamp: Date.now(),
      sessionId: this.sessionId ?? undefined,
      payload: {},
    });
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  getReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  getCurrentSessionId(): string | null {
    return this.sessionId;
  }

  getCurrentChannelId(): string {
    return this.channelId;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async establishConnection(): Promise<void> {
    const store = useAppStore.getState();
    store.setStatus("connecting");

    try {
      await this.wakeGatewayIfNeeded();

      const wsUrl = this.token
        ? `${this.url}?token=${encodeURIComponent(this.token)}`
        : this.url;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        useAppStore.getState().setStatus("connecting");
        console.log("[GatewayClient] WebSocket opened");

        this.send({
          id: generateId(),
          type: "connect",
          timestamp: Date.now(),
          payload: {
            channelType: "mobile",
            channelId: this.channelId,
            metadata: {
              token: this.token,
              platform: "mobile",
            },
          },
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: ProtocolMessage = JSON.parse(
            typeof event.data === "string" ? event.data : "",
          );
          if (message.type === "connect.ack") {
            this.sessionId = message.payload?.sessionId as string | null;
            this.channelId =
              (message.payload?.channelId as string | undefined) ??
              this.channelId;
            useAppStore.getState().setStatus("connected");
          }
          if (message.type === "heartbeat.check") {
            this.send({
              id: generateId(),
              type: "heartbeat.ack",
              timestamp: Date.now(),
              payload: { clientTime: Date.now() },
            });
            return;
          }
          this.handleProtocolMessage(message);
          this.handlers.forEach((handler) => handler(message));
        } catch (err) {
          console.error("[GatewayClient] Failed to parse message:", err);
        }
      };

      this.ws.onerror = (event) => {
        console.error("[GatewayClient] WebSocket error:", event);
        useAppStore.getState().setStatus("error");
      };

      this.ws.onclose = (event) => {
        console.log(
          "[GatewayClient] Connection closed:",
          event.code,
          event.reason,
        );
        this.ws = null;

        if (!this.intentionalClose) {
          useAppStore.getState().setStatus("disconnected");
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.error("[GatewayClient] Failed to connect:", err);
      store.setStatus("error");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn("[GatewayClient] Max reconnect attempts reached");
      useAppStore.getState().setStatus("error");
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    console.log(
      `[GatewayClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      void this.establishConnection();
    }, delay);
  }

  private async wakeGatewayIfNeeded(): Promise<void> {
    if (this.url.includes("localhost") || this.url.includes("127.0.0.1")) {
      return;
    }

    const healthUrl = deriveMobileGatewayHealthUrl(this.url);

    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const response = await Promise.race([
          globalThis.fetch(healthUrl),
          new Promise<Response | null>((resolve) => {
            setTimeout(() => resolve(null), 8000);
          }),
        ]);

        if (response?.ok) {
          return;
        }
      } catch (error) {
        console.warn("[GatewayClient] Gateway warmup failed:", error);
      }

      await new Promise((resolve) => {
        setTimeout(resolve, Math.min(2000 + attempt * 1500, 6000));
      });
    }
  }

  private handleProtocolMessage(message: ProtocolMessage): void {
    const store = useAppStore.getState();
    const payload = message.payload ?? {};

    switch (message.type) {
      case "connect.ack": {
        this.sessionId = (payload.sessionId as string) ?? null;
        this.channelId =
          (payload.channelId as string | undefined) ?? this.channelId;
        store.setStatus("connected");
        store.setTyping(false);
        break;
      }

      case "connect.challenge": {
        store.setStatus("error");
        store.setTyping(false);
        this.addSystemMessage(
          "This gateway requires an auth token. Add a gateway token in Settings, or reconnect to the hosted public Karna gateway.",
        );
        break;
      }

      case "error": {
        const code = (payload.code as string | undefined) ?? "GATEWAY_ERROR";
        const messageText =
          (payload.message as string | undefined) ??
          "The gateway could not process this request. Please try again.";
        store.setTyping(false);
        if (
          code === "UNAUTHENTICATED" ||
          code === "MISSING_SESSION" ||
          code === "SESSION_NOT_FOUND"
        ) {
          store.setStatus("error");
        }
        this.addSystemMessage(messageText);
        break;
      }

      case "agent.response": {
        store.setTyping(false);
        const content = (payload.content as string) ?? "";
        if (this.pendingStreamMessageId) {
          store.updateMessage(this.pendingStreamMessageId, {
            content,
            toolCalls: payload.toolCalls as ToolCall[] | undefined,
          });
        } else {
          const assistantMessage: ChatMessage = {
            id: message.id ?? generateId(),
            role: "assistant",
            content,
            timestamp: Date.now(),
            toolCalls: payload.toolCalls as ToolCall[] | undefined,
          };
          store.addMessage(assistantMessage);
        }
        this.pendingStreamMessageId = null;
        break;
      }

      case "chat.response": {
        store.setTyping(false);
        const assistantMessage: ChatMessage = {
          id: message.id ?? generateId(),
          role: "assistant",
          content: (payload.content as string) ?? "",
          timestamp: Date.now(),
          toolCalls: payload.toolCalls as ToolCall[] | undefined,
        };
        store.addMessage(assistantMessage);
        break;
      }

      case "agent.response.stream": {
        const delta = (payload.delta as string) ?? "";
        if (!this.pendingStreamMessageId) {
          this.pendingStreamMessageId = message.id ?? generateId();
          store.addMessage({
            id: this.pendingStreamMessageId,
            role: "assistant",
            content: delta,
            timestamp: Date.now(),
          });
        } else {
          const existing = store.messages.find(
            (m) => m.id === this.pendingStreamMessageId,
          );
          if (existing) {
            store.updateMessage(this.pendingStreamMessageId, {
              content: existing.content + delta,
            });
          }
        }
        break;
      }

      case "chat.stream.start": {
        const streamMessage: ChatMessage = {
          id: message.id ?? generateId(),
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        };
        store.addMessage(streamMessage);
        break;
      }

      case "chat.stream.delta": {
        if (message.id) {
          const existing = store.messages.find((m) => m.id === message.id);
          if (existing) {
            store.updateMessage(message.id, {
              content: existing.content + ((payload.delta as string) ?? ""),
            });
          }
        }
        break;
      }

      case "chat.stream.end": {
        store.setTyping(false);
        if (message.id && payload.toolCalls) {
          store.updateMessage(message.id, {
            toolCalls: payload.toolCalls as ToolCall[],
          });
        }
        break;
      }

      case "voice.transcript": {
        const text = (payload.text as string) ?? "";
        const isFinal = Boolean(payload.isFinal);
        if (isFinal && text.trim()) {
          store.addMessage({
            id: message.id ?? generateId(),
            role: "user",
            content: text,
            timestamp: Date.now(),
          });
          store.setTyping(true);
        }
        break;
      }

      case "voice.audio.response": {
        const transcript = (payload.transcript as string) ?? "";
        const latestAssistant = store.messages.find(
          (entry) => entry.role === "assistant",
        );
        if (transcript.trim() && latestAssistant?.content !== transcript) {
          store.addMessage({
            id: message.id ?? generateId(),
            role: "assistant",
            content: transcript,
            timestamp: Date.now(),
          });
        }

        const audioData = payload.data as string | undefined;
        const format = (payload.format as string | undefined) ?? "mp3";
        if (audioData) {
          playAudioResponse(audioData, format).catch((err) => {
            console.warn("[GatewayClient] Failed to play voice response:", err);
          });
        }

        store.setTyping(false);
        break;
      }

      case "status": {
        const state = payload.state as string | undefined;
        if (
          state === "thinking" ||
          state === "streaming" ||
          state === "tool_calling"
        ) {
          store.setTyping(true);
        } else if (state === "idle" || state === "error") {
          store.setTyping(false);
          if (state === "idle") {
            this.pendingStreamMessageId = null;
          }
        }
        break;
      }

      case "tool.start": {
        if (message.id) {
          const parentId = payload.messageId as string | undefined;
          if (parentId) {
            const parent = store.messages.find((m) => m.id === parentId);
            if (parent) {
              const toolCall: ToolCall = {
                id: message.id,
                name: (payload.name as string) ?? "unknown",
                status: "running",
                input: payload.input as Record<string, unknown> | undefined,
              };
              store.updateMessage(parentId, {
                toolCalls: [...(parent.toolCalls ?? []), toolCall],
              });
            }
          }
        }
        break;
      }

      case "tool.end": {
        if (message.id) {
          const parentId = payload.messageId as string | undefined;
          if (parentId) {
            const parent = store.messages.find((m) => m.id === parentId);
            if (parent) {
              store.updateMessage(parentId, {
                toolCalls: parent.toolCalls?.map((tc) =>
                  tc.id === message.id
                    ? {
                        ...tc,
                        status: (payload.error
                          ? "error"
                          : "success") as ToolCall["status"],
                        output:
                          (payload.output as string) ??
                          (payload.error as string) ??
                          "",
                        duration: payload.duration as number | undefined,
                      }
                    : tc,
                ),
              });
            }
          }
        }
        break;
      }

      case "typing.start": {
        store.setTyping(true);
        break;
      }

      case "typing.stop": {
        store.setTyping(false);
        break;
      }

      // ── Memory handlers ─────────────────────────────────────────────────

      case "memory.search.result": {
        const results = payload.results as MemoryEntry[] | undefined;
        if (results) {
          store.setMemories(results);
        }
        break;
      }

      case "memory.list": {
        const memories = payload.memories as MemoryEntry[] | undefined;
        if (memories) {
          store.setMemories(memories);
        }
        break;
      }

      // ── Skill handlers ──────────────────────────────────────────────────

      case "skill.list": {
        const skills = payload.skills as Skill[] | undefined;
        if (skills) {
          store.setSkills(skills);
        }
        break;
      }

      case "skill.toggle.result": {
        const skillId = payload.skillId as string | undefined;
        const active = payload.active as boolean | undefined;
        if (skillId && active !== undefined) {
          store.setSkills(
            store.skills.map((s) => (s.id === skillId ? { ...s, active } : s)),
          );
        }
        break;
      }

      // ── Reminder handlers ───────────────────────────────────────────────

      case "reminder.list": {
        const reminders = payload.reminders as Reminder[] | undefined;
        if (reminders) {
          // Replace entire reminders list from gateway
          useAppStore.setState({ reminders });
        }
        break;
      }

      case "reminder.created": {
        const reminder = payload.reminder as Reminder | undefined;
        if (reminder) {
          store.addReminder(reminder);
        }
        break;
      }

      // ── Chat history handler ────────────────────────────────────────────

      case "chat.history": {
        const olderMessages = payload.messages as ChatMessage[] | undefined;
        if (olderMessages && olderMessages.length > 0) {
          store.loadOlderMessages(olderMessages);
        }
        break;
      }

      default:
        break;
    }
  }

  private addSystemMessage(content: string): void {
    const store = useAppStore.getState();
    const latest = store.messages[0];
    if (latest?.role === "system" && latest.content === content) {
      return;
    }

    store.addMessage({
      id: generateId(),
      role: "system",
      content,
      timestamp: Date.now(),
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const gatewayClient = new GatewayClient();
