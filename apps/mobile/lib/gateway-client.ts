import { useAppStore } from './store';
import type { ChatMessage, ToolCall, MemoryEntry, Skill, Reminder } from './store';
import { readAudioFileAsBase64, playAudioResponse } from './voice';

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
  private url = '';
  private token = '';
  private intentionalClose = false;
  private sessionId: string | null = null;
  private pendingStreamMessageId: string | null = null;

  connect(url: string, token: string): void {
    this.url = url;
    this.token = token;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;
    this.establishConnection();
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.sessionId = null;
    this.pendingStreamMessageId = null;
    useAppStore.getState().setStatus('disconnected');
  }

  send(message: ProtocolMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[GatewayClient] Cannot send: WebSocket not open');
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  sendChatMessage(content: string): void {
    const id = generateId();
    const userMessage: ChatMessage = {
      id,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    useAppStore.getState().addMessage(userMessage);
    useAppStore.getState().setTyping(true);

    this.send({
      id,
      type: 'chat.message',
      timestamp: Date.now(),
      sessionId: this.sessionId ?? undefined,
      payload: { content, role: 'user' },
    });
  }

  async sendVoiceMessage(audioUri: string): Promise<void> {
    const base64 = await readAudioFileAsBase64(audioUri);
    const chunkSize = 32_000;

    this.send({
      id: generateId(),
      type: 'voice.start',
      timestamp: Date.now(),
      sessionId: this.sessionId ?? undefined,
      payload: { mode: 'push-to-talk' },
    });

    for (let offset = 0; offset < base64.length; offset += chunkSize) {
      this.send({
        id: generateId(),
        type: 'voice.audio.chunk',
        timestamp: Date.now(),
        sessionId: this.sessionId ?? undefined,
        payload: {
          data: base64.slice(offset, offset + chunkSize),
          format: 'm4a',
          sampleRate: 44100,
        },
      });
    }

    this.send({
      id: generateId(),
      type: 'voice.end',
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

  // ── Private ──────────────────────────────────────────────────────────────

  private establishConnection(): void {
    const store = useAppStore.getState();
    store.setStatus('connecting');

    try {
      const wsUrl = this.token
        ? `${this.url}?token=${encodeURIComponent(this.token)}`
        : this.url;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        useAppStore.getState().setStatus('connected');
        console.log('[GatewayClient] Connected');

        this.send({
          id: generateId(),
          type: 'connect',
          timestamp: Date.now(),
          payload: {
            channelType: 'mobile',
            channelId: 'mobile-chat',
            metadata: {
              token: this.token,
              platform: 'mobile',
            },
          },
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: ProtocolMessage = JSON.parse(
            typeof event.data === 'string' ? event.data : '',
          );
          if (message.type === 'connect.ack') {
            this.sessionId = message.payload?.sessionId as string | null;
          }
          if (message.type === 'heartbeat.check') {
            this.send({
              id: generateId(),
              type: 'heartbeat.ack',
              timestamp: Date.now(),
              payload: { clientTime: Date.now() },
            });
            return;
          }
          this.handleProtocolMessage(message);
          this.handlers.forEach((handler) => handler(message));
        } catch (err) {
          console.error('[GatewayClient] Failed to parse message:', err);
        }
      };

      this.ws.onerror = (event) => {
        console.error('[GatewayClient] WebSocket error:', event);
        useAppStore.getState().setStatus('error');
      };

      this.ws.onclose = (event) => {
        console.log('[GatewayClient] Connection closed:', event.code, event.reason);
        this.ws = null;

        if (!this.intentionalClose) {
          useAppStore.getState().setStatus('disconnected');
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      console.error('[GatewayClient] Failed to connect:', err);
      store.setStatus('error');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[GatewayClient] Max reconnect attempts reached');
      useAppStore.getState().setStatus('error');
      return;
    }

    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      30000,
    );
    this.reconnectAttempts++;
    console.log(
      `[GatewayClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.establishConnection();
    }, delay);
  }

  private handleProtocolMessage(message: ProtocolMessage): void {
    const store = useAppStore.getState();
    const payload = message.payload ?? {};

    switch (message.type) {
      case 'connect.ack': {
        this.sessionId = (payload.sessionId as string) ?? null;
        break;
      }

      case 'agent.response': {
        store.setTyping(false);
        const content = (payload.content as string) ?? '';
        if (this.pendingStreamMessageId) {
          store.updateMessage(this.pendingStreamMessageId, {
            content,
            toolCalls: payload.toolCalls as ToolCall[] | undefined,
          });
        } else {
          const assistantMessage: ChatMessage = {
            id: message.id ?? generateId(),
            role: 'assistant',
            content,
            timestamp: Date.now(),
            toolCalls: payload.toolCalls as ToolCall[] | undefined,
          };
          store.addMessage(assistantMessage);
        }
        this.pendingStreamMessageId = null;
        break;
      }

      case 'chat.response': {
        store.setTyping(false);
        const assistantMessage: ChatMessage = {
          id: message.id ?? generateId(),
          role: 'assistant',
          content: (payload.content as string) ?? '',
          timestamp: Date.now(),
          toolCalls: payload.toolCalls as ToolCall[] | undefined,
        };
        store.addMessage(assistantMessage);
        break;
      }

      case 'agent.response.stream': {
        const delta = (payload.delta as string) ?? '';
        if (!this.pendingStreamMessageId) {
          this.pendingStreamMessageId = message.id ?? generateId();
          store.addMessage({
            id: this.pendingStreamMessageId,
            role: 'assistant',
            content: delta,
            timestamp: Date.now(),
          });
        } else {
          const existing = store.messages.find((m) => m.id === this.pendingStreamMessageId);
          if (existing) {
            store.updateMessage(this.pendingStreamMessageId, {
              content: existing.content + delta,
            });
          }
        }
        break;
      }

      case 'chat.stream.start': {
        const streamMessage: ChatMessage = {
          id: message.id ?? generateId(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        };
        store.addMessage(streamMessage);
        break;
      }

      case 'chat.stream.delta': {
        if (message.id) {
          const existing = store.messages.find((m) => m.id === message.id);
          if (existing) {
            store.updateMessage(message.id, {
              content: existing.content + ((payload.delta as string) ?? ''),
            });
          }
        }
        break;
      }

      case 'chat.stream.end': {
        store.setTyping(false);
        if (message.id && payload.toolCalls) {
          store.updateMessage(message.id, {
            toolCalls: payload.toolCalls as ToolCall[],
          });
        }
        break;
      }

      case 'voice.transcript': {
        const text = (payload.text as string) ?? '';
        const isFinal = Boolean(payload.isFinal);
        if (isFinal && text.trim()) {
          store.addMessage({
            id: message.id ?? generateId(),
            role: 'user',
            content: text,
            timestamp: Date.now(),
          });
          store.setTyping(true);
        }
        break;
      }

      case 'voice.audio.response': {
        const transcript = (payload.transcript as string) ?? '';
        const latestAssistant = store.messages.find((entry) => entry.role === 'assistant');
        if (transcript.trim() && latestAssistant?.content !== transcript) {
          store.addMessage({
            id: message.id ?? generateId(),
            role: 'assistant',
            content: transcript,
            timestamp: Date.now(),
          });
        }

        const audioData = payload.data as string | undefined;
        const format = (payload.format as string | undefined) ?? 'mp3';
        if (audioData) {
          playAudioResponse(audioData, format).catch((err) => {
            console.warn('[GatewayClient] Failed to play voice response:', err);
          });
        }

        store.setTyping(false);
        break;
      }

      case 'status': {
        const state = payload.state as string | undefined;
        if (state === 'thinking' || state === 'streaming' || state === 'tool_calling') {
          store.setTyping(true);
        } else if (state === 'idle' || state === 'error') {
          store.setTyping(false);
          if (state === 'idle') {
            this.pendingStreamMessageId = null;
          }
        }
        break;
      }

      case 'tool.start': {
        if (message.id) {
          const parentId = payload.messageId as string | undefined;
          if (parentId) {
            const parent = store.messages.find((m) => m.id === parentId);
            if (parent) {
              const toolCall: ToolCall = {
                id: message.id,
                name: (payload.name as string) ?? 'unknown',
                status: 'running',
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

      case 'tool.end': {
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
                        status: (payload.error ? 'error' : 'success') as ToolCall['status'],
                        output: (payload.output as string) ?? (payload.error as string) ?? '',
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

      case 'typing.start': {
        store.setTyping(true);
        break;
      }

      case 'typing.stop': {
        store.setTyping(false);
        break;
      }

      // ── Memory handlers ─────────────────────────────────────────────────

      case 'memory.search.result': {
        const results = payload.results as MemoryEntry[] | undefined;
        if (results) {
          store.setMemories(results);
        }
        break;
      }

      case 'memory.list': {
        const memories = payload.memories as MemoryEntry[] | undefined;
        if (memories) {
          store.setMemories(memories);
        }
        break;
      }

      // ── Skill handlers ──────────────────────────────────────────────────

      case 'skill.list': {
        const skills = payload.skills as Skill[] | undefined;
        if (skills) {
          store.setSkills(skills);
        }
        break;
      }

      case 'skill.toggle.result': {
        const skillId = payload.skillId as string | undefined;
        const active = payload.active as boolean | undefined;
        if (skillId && active !== undefined) {
          store.setSkills(
            store.skills.map((s) =>
              s.id === skillId ? { ...s, active } : s,
            ),
          );
        }
        break;
      }

      // ── Reminder handlers ───────────────────────────────────────────────

      case 'reminder.list': {
        const reminders = payload.reminders as Reminder[] | undefined;
        if (reminders) {
          // Replace entire reminders list from gateway
          useAppStore.setState({ reminders });
        }
        break;
      }

      case 'reminder.created': {
        const reminder = payload.reminder as Reminder | undefined;
        if (reminder) {
          store.addReminder(reminder);
        }
        break;
      }

      // ── Chat history handler ────────────────────────────────────────────

      case 'chat.history': {
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
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const gatewayClient = new GatewayClient();
