import { useAppStore } from "./store";
import type {
  ChatMessage,
  ToolCall,
  MemoryEntry,
  Skill,
  Reminder,
  ToolApprovalRequest,
} from "./store";
import { readAudioFileAsBase64, playAudioResponse } from "./voice";
import {
  deriveMobileGatewayHttpUrl,
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
  private historyInFlight = false;
  private channelId = `mobile-${generateId()}`;
  private approvalAllForSession = false;
  private approvalTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private streamDeltaBuffers = new Map<string, string>();
  private streamFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  connect(url: string, token: string): void {
    this.url = normalizeMobileGatewayWsUrl(url);
    this.token = token;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    useAppStore.getState().setReconnectAttempts(0);
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
    this.approvalAllForSession = false;
    this.clearApprovalTimeouts();
    this.clearStreamFlushTimers();
    const store = useAppStore.getState();
    store.setStatus("disconnected");
    store.setPendingToolApproval(null);
    store.setReconnectAttempts(0);
    store.setLatency(null);
  }

  send(message: ProtocolMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[GatewayClient] Cannot send: WebSocket not open");
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  async refreshTasks(): Promise<void> {
    this.send({
      id: generateId(),
      type: "reminder.list",
      timestamp: Date.now(),
      sessionId: this.sessionId ?? undefined,
      payload: {},
    });
  }

  async refreshMemories(
    options: { query?: string; category?: MemoryEntry["category"] } = {},
  ): Promise<void> {
    const memoryUrl = deriveMobileGatewayHttpUrl(
      this.url || useAppStore.getState().url,
    );
    memoryUrl.pathname = "/api/memory";
    memoryUrl.searchParams.set("limit", "100");
    if (options.query) {
      memoryUrl.searchParams.set("query", options.query);
    }
    if (options.category) {
      memoryUrl.searchParams.set("category", options.category);
    }

    const response = await fetch(memoryUrl.toString());
    if (!response.ok) {
      throw new Error(`Memory refresh failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      entries?: Array<Record<string, unknown>>;
      memories?: Array<Record<string, unknown>>;
    };
    const memories = (payload.entries ?? payload.memories ?? []).map(
      mapMemoryEntry,
    );
    useAppStore.getState().setMemories(memories);
  }

  async refreshSkills(): Promise<void> {
    const skillsUrl = deriveMobileGatewayHttpUrl(
      this.url || useAppStore.getState().url,
    );
    skillsUrl.pathname = "/api/skills";

    const response = await fetch(skillsUrl.toString());
    if (!response.ok) {
      throw new Error(`Skills refresh failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      skills?: Array<Record<string, unknown>>;
    };
    useAppStore.getState().setSkills((payload.skills ?? []).map(mapSkill));
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
      payload: {
        content,
        role: "user",
        metadata: store.connectionQuality.compactMode
          ? { compactMode: true, stream: false }
          : undefined,
      },
    });
  }

  async loadChatHistory(limit = 20): Promise<void> {
    if (!this.sessionId || this.historyInFlight) {
      return;
    }

    this.historyInFlight = true;

    try {
      const historyUrl = deriveMobileGatewayHttpUrl(this.url);
      historyUrl.pathname = `/api/sessions/${encodeURIComponent(
        this.sessionId,
      )}/history`;
      historyUrl.searchParams.set("limit", String(limit));

      const response = await fetch(historyUrl.toString());
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
        messages?: Array<Record<string, unknown>>;
      };
      const messages = (payload.messages ?? [])
        .map(mapHistoryMessage)
        .filter((message): message is ChatMessage => message !== null)
        .reverse();

      if (messages.length > 0) {
        useAppStore.getState().loadOlderMessages(messages);
      }
    } catch (error) {
      console.warn("[GatewayClient] Failed to load chat history:", error);
    } finally {
      this.historyInFlight = false;
    }
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

  respondToToolApproval(
    toolCallId: string,
    approved: boolean,
    options: { approveAllForSession?: boolean; reason?: string } = {},
  ): void {
    const store = useAppStore.getState();
    const pending = store.pendingToolApproval;
    const toolName = pending?.toolName ?? "tool";
    const toolInput = pending?.arguments;
    const reason =
      options.reason ??
      (approved
        ? "Approved from mobile."
        : "Denied from mobile.");

    if (approved && options.approveAllForSession) {
      this.approvalAllForSession = true;
    }

    this.clearApprovalTimeout(toolCallId);
    store.setPendingToolApproval(null);
    this.attachToolApprovalDecision(toolCallId, toolName, toolInput, approved, reason);

    this.send({
      id: generateId(),
      type: "tool.approval.response",
      timestamp: Date.now(),
      sessionId: this.sessionId ?? undefined,
      payload: {
        toolCallId,
        approved,
        reason,
      },
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
        const currentStore = useAppStore.getState();
        currentStore.setStatus("connecting");
        currentStore.setReconnectAttempts(0);
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
            const serverTime = message.payload?.serverTime;
            if (typeof serverTime === "number") {
              useAppStore
                .getState()
                .setLatency(Math.max(0, Date.now() - serverTime));
            }
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
    useAppStore.getState().setReconnectAttempts(this.reconnectAttempts);
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
          this.flushStreamingDelta(this.pendingStreamMessageId);
          store.updateMessage(this.pendingStreamMessageId, {
            content,
            toolCalls: payload.toolCalls as ToolCall[] | undefined,
            isStreaming: false,
          });
        } else {
          const assistantMessage: ChatMessage = {
            id: message.id ?? generateId(),
            role: "assistant",
            content,
            timestamp: Date.now(),
            toolCalls: payload.toolCalls as ToolCall[] | undefined,
            isStreaming: false,
          };
          store.addMessage(assistantMessage);
        }
        this.pendingStreamMessageId = null;
        break;
      }

      case "agent.response.stream": {
        const delta = (payload.delta as string) ?? "";
        if (!this.pendingStreamMessageId) {
          this.pendingStreamMessageId = message.id ?? generateId();
          store.addMessage({
            id: this.pendingStreamMessageId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            isStreaming: true,
          });
        }
        this.appendStreamingDelta(this.pendingStreamMessageId, delta);
        if (payload.finishReason) {
          this.flushStreamingDelta(this.pendingStreamMessageId);
          store.updateMessage(this.pendingStreamMessageId, {
            isStreaming: false,
          });
          this.pendingStreamMessageId = null;
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

      case "tool.approval.requested": {
        const toolCallId = payload.toolCallId as string | undefined;
        const toolName = (payload.toolName as string | undefined) ?? "tool";
        const riskLevel = parseRiskLevel(payload.riskLevel);
        const toolInput = isRecord(payload.arguments)
          ? payload.arguments
          : undefined;
        const description =
          typeof payload.description === "string" ? payload.description : undefined;

        if (!toolCallId) {
          this.addSystemMessage(
            "Karna requested a tool, but the gateway did not include a valid approval id. The request was not approved.",
          );
          store.setTyping(false);
          break;
        }

        if (this.approvalAllForSession) {
          this.send({
            id: generateId(),
            type: "tool.approval.response",
            timestamp: Date.now(),
            sessionId: this.sessionId ?? message.sessionId,
            payload: {
              toolCallId,
              approved: true,
              reason: "Approved by mobile approve-all for this session.",
            },
          });
          break;
        }

        const requestedAt = Date.now();
        const request: ToolApprovalRequest = {
          toolCallId,
          toolName,
          riskLevel,
          arguments: toolInput,
          description,
          requestedAt,
          expiresAt: requestedAt + 60_000,
        };

        this.clearApprovalTimeout(toolCallId);
        store.setPendingToolApproval(request);
        this.approvalTimeouts.set(
          toolCallId,
          setTimeout(() => {
            if (useAppStore.getState().pendingToolApproval?.toolCallId !== toolCallId) {
              return;
            }
            this.respondToToolApproval(toolCallId, false, {
              reason: "Rejected: mobile approval timed out after 60 seconds.",
            });
          }, 60_000),
        );
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

      // ── Orchestration handlers ─────────────────────────────────────────

      case "skill.result": {
        const skillOutput = (payload.result as string) ?? "";
        const isError = Boolean(payload.isError);
        if (isError) {
          this.addSystemMessage(
            `Skill "${(payload.skillId as string) ?? "unknown"}" failed: ${skillOutput}`,
          );
        }
        break;
      }

      case "agent.handoff": {
        const reason = (payload.reason as string) ?? "";
        if (reason) {
          this.addSystemMessage(`Agent handoff: ${reason}`);
        }
        break;
      }

      case "orchestration.status": {
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

  private attachToolApprovalDecision(
    toolCallId: string,
    toolName: string,
    toolInput: Record<string, unknown> | undefined,
    approved: boolean,
    reason: string,
  ): void {
    const store = useAppStore.getState();
    const parent =
      (this.pendingStreamMessageId
        ? store.messages.find(
            (message) => message.id === this.pendingStreamMessageId,
          )
        : undefined) ??
      store.messages.find((message) => message.role === "assistant");

    if (!parent) {
      return;
    }

    const toolCall: ToolCall = {
      id: toolCallId,
      name: toolName,
      status: approved ? "success" : "error",
      input: toolInput,
      output: reason,
    };

    store.updateMessage(parent.id, {
      toolCalls: [...(parent.toolCalls ?? []), toolCall],
    });
  }

  private clearApprovalTimeout(toolCallId: string): void {
    const timer = this.approvalTimeouts.get(toolCallId);
    if (timer) {
      clearTimeout(timer);
      this.approvalTimeouts.delete(toolCallId);
    }
  }

  private clearApprovalTimeouts(): void {
    for (const timer of this.approvalTimeouts.values()) {
      clearTimeout(timer);
    }
    this.approvalTimeouts.clear();
  }

  private appendStreamingDelta(messageId: string, delta: string): void {
    if (!delta) return;
    const pending = this.streamDeltaBuffers.get(messageId) ?? "";
    this.streamDeltaBuffers.set(messageId, pending + delta);

    if (this.streamFlushTimers.has(messageId)) {
      return;
    }

    this.streamFlushTimers.set(
      messageId,
      setTimeout(() => {
        this.flushStreamingDelta(messageId);
      }, 50),
    );
  }

  private flushStreamingDelta(messageId: string): void {
    const timer = this.streamFlushTimers.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.streamFlushTimers.delete(messageId);
    }

    const delta = this.streamDeltaBuffers.get(messageId);
    if (!delta) return;

    this.streamDeltaBuffers.delete(messageId);
    const store = useAppStore.getState();
    const existing = store.messages.find((message) => message.id === messageId);
    if (!existing) return;

    store.updateMessage(messageId, {
      content: existing.content + delta,
      isStreaming: true,
    });
  }

  private clearStreamFlushTimers(): void {
    for (const timer of this.streamFlushTimers.values()) {
      clearTimeout(timer);
    }
    this.streamFlushTimers.clear();
    this.streamDeltaBuffers.clear();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isChatRole(role: unknown): role is ChatMessage["role"] {
  return role === "user" || role === "assistant" || role === "system";
}

function mapHistoryMessage(entry: Record<string, unknown>): ChatMessage | null {
  const { id, role, content, timestamp } = entry;
  if (
    typeof id !== "string" ||
    !isChatRole(role) ||
    typeof content !== "string" ||
    typeof timestamp !== "number"
  ) {
    return null;
  }

  return { id, role, content, timestamp };
}

function mapMemoryEntry(entry: Record<string, unknown>): MemoryEntry {
  const category = entry.category;
  const importance =
    typeof entry.importance === "number"
      ? entry.importance
      : typeof entry.priority === "number"
        ? entry.priority
        : 0.5;

  return {
    id: String(entry.id ?? generateId()),
    content: String(entry.content ?? entry.summary ?? ""),
    category:
      category === "fact" ||
      category === "preference" ||
      category === "event" ||
      category === "task"
        ? category
        : "fact",
    importance: Math.max(0, Math.min(1, importance)),
    createdAt:
      typeof entry.createdAt === "number"
        ? entry.createdAt
        : Date.parse(String(entry.createdAt ?? "")) || Date.now(),
  };
}

function mapSkill(entry: Record<string, unknown>): Skill {
  return {
    id: String(entry.id ?? entry.name ?? generateId()),
    name: String(entry.name ?? entry.id ?? "Untitled skill"),
    description: String(entry.description ?? ""),
    icon: String(entry.icon ?? "zap"),
    active:
      typeof entry.active === "boolean"
        ? entry.active
        : typeof entry.enabled === "boolean"
          ? entry.enabled
          : true,
    version: String(entry.version ?? "1.0.0"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRiskLevel(value: unknown): ToolApprovalRequest["riskLevel"] {
  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
  ) {
    return value;
  }
  return "medium";
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const gatewayClient = new GatewayClient();
