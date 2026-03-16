import { useAppStore } from './store';
import type { ChatMessage, ToolCall } from './store';

// ── Protocol Types ───────────────────────────────────────────────────────────

interface ProtocolMessage {
  type: string;
  id?: string;
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
      type: 'chat.message',
      id,
      payload: { content, role: 'user' },
    });
  }

  sendVoiceMessage(audioUri: string): void {
    const id = generateId();
    this.send({
      type: 'chat.voice',
      id,
      payload: { audioUri },
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

        this.send({ type: 'client.hello', payload: { platform: 'mobile' } });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: ProtocolMessage = JSON.parse(
            typeof event.data === 'string' ? event.data : '',
          );
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
