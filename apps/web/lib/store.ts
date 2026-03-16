import { create } from "zustand";
import type { WSState } from "./ws";

// ─── Chat Types ─────────────────────────────────────────────────────────────

export interface ChatMessageUI {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  toolCalls?: ToolCallUI[];
  isStreaming?: boolean;
  metadata?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    toolCallId?: string;
    toolName?: string;
    finishReason?: string;
    latencyMs?: number;
  };
}

export interface ToolCallUI {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface ChatSessionUI {
  id: string;
  title: string;
  channelType: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

// ─── Chat Store ─────────────────────────────────────────────────────────────

interface ChatState {
  sessions: ChatSessionUI[];
  activeSessionId: string | null;
  messages: ChatMessageUI[];
  agentState: "idle" | "thinking" | "tool_calling" | "streaming" | "error";
  wsState: WSState;
  streamingContent: string;

  // Actions
  setSessions: (sessions: ChatSessionUI[]) => void;
  setActiveSession: (id: string | null) => void;
  addMessage: (message: ChatMessageUI) => void;
  updateMessage: (id: string, update: Partial<ChatMessageUI>) => void;
  appendStreamDelta: (delta: string) => void;
  resetStream: () => void;
  setMessages: (messages: ChatMessageUI[]) => void;
  setAgentState: (state: ChatState["agentState"]) => void;
  setWSState: (state: WSState) => void;
  updateToolCall: (messageId: string, toolCallId: string, update: Partial<ToolCallUI>) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  agentState: "idle",
  wsState: "disconnected",
  streamingContent: "",

  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (id) => set({ activeSessionId: id }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateMessage: (id, update) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...update } : m,
      ),
    })),

  appendStreamDelta: (delta) =>
    set((state) => ({
      streamingContent: state.streamingContent + delta,
    })),

  resetStream: () => set({ streamingContent: "" }),

  setMessages: (messages) => set({ messages }),

  setAgentState: (agentState) => set({ agentState }),

  setWSState: (wsState) => set({ wsState }),

  updateToolCall: (messageId, toolCallId, update) =>
    set((state) => ({
      messages: state.messages.map((m) => {
        if (m.id !== messageId) return m;
        return {
          ...m,
          toolCalls: m.toolCalls?.map((tc) =>
            tc.id === toolCallId ? { ...tc, ...update } : tc,
          ),
        };
      }),
    })),

  clearChat: () =>
    set({ messages: [], streamingContent: "", agentState: "idle" }),
}));

// ─── Dashboard Store ────────────────────────────────────────────────────────

interface DashboardState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}));
