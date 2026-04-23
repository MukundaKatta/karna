import { create } from "zustand";
import * as FileSystem from "expo-file-system";
import {
  isLegacyLocalGatewayUrl,
  resolveDefaultMobileGatewayWsUrl,
} from "./runtime-config";

// ── Persistence ─────────────────────────────────────────────────────────────

const STORE_FILE = `${FileSystem.documentDirectory}karna-store.json`;

interface PersistedState {
  darkMode: boolean;
  notifications: boolean;
  agentName: string;
  url: string;
  token: string;
  liveVoiceEnabled: boolean;
  liveVoicePeerChannelId: string;
  messages: ChatMessage[];
  reminders: Reminder[];
  skills: Skill[];
}

const PERSIST_KEYS: (keyof PersistedState)[] = [
  "darkMode",
  "notifications",
  "agentName",
  "url",
  "token",
  "liveVoiceEnabled",
  "liveVoicePeerChannelId",
  "messages",
  "reminders",
  "skills",
];

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const HISTORY_DUPLICATE_WINDOW_MS = 120_000;

function persistState(state: Record<string, unknown>): void {
  // Debounce writes to avoid thrashing disk
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const toPersist: Record<string, unknown> = {};
    for (const key of PERSIST_KEYS) {
      toPersist[key] = state[key];
    }
    // Keep only the last 100 messages
    if (Array.isArray(toPersist.messages)) {
      toPersist.messages = (toPersist.messages as ChatMessage[]).slice(0, 100);
    }
    FileSystem.writeAsStringAsync(STORE_FILE, JSON.stringify(toPersist)).catch(
      (err) => console.warn("[Store] Failed to persist state:", err),
    );
  }, 500);
}

export async function loadPersistedState(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(STORE_FILE);
    if (!info.exists) return;

    const raw = await FileSystem.readAsStringAsync(STORE_FILE);
    const data = JSON.parse(raw) as Partial<PersistedState>;
    const patch: Record<string, unknown> = {};

    for (const key of PERSIST_KEYS) {
      if (data[key] !== undefined) {
        patch[key] = data[key];
      }
    }

    if (typeof patch.url !== "string" || isLegacyLocalGatewayUrl(patch.url)) {
      patch.url = resolveDefaultMobileGatewayWsUrl();
    }

    if (Object.keys(patch).length > 0) {
      useAppStore.setState(patch);
      console.log("[Store] Restored persisted state");
    }
  } catch (err) {
    console.warn("[Store] Failed to load persisted state:", err);
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  status: "running" | "success" | "error";
  input?: Record<string, unknown>;
  output?: string;
  duration?: number;
}

export interface Reminder {
  id: string;
  title: string;
  description?: string;
  dueDate?: number;
  status: "pending" | "in-progress" | "done";
  createdAt: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  category: "fact" | "preference" | "event" | "task";
  importance: number;
  createdAt: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  icon: string;
  active: boolean;
  version: string;
}

// ── Store State ──────────────────────────────────────────────────────────────

interface ConnectionSlice {
  status: ConnectionStatus;
  url: string;
  token: string;
  setStatus: (status: ConnectionStatus) => void;
  setUrl: (url: string) => void;
  setToken: (token: string) => void;
}

interface ChatSlice {
  messages: ChatMessage[];
  isTyping: boolean;
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  setTyping: (typing: boolean) => void;
  clearChat: () => void;
  loadOlderMessages: (messages: ChatMessage[]) => void;
}

interface TaskSlice {
  reminders: Reminder[];
  addReminder: (reminder: Reminder) => void;
  updateReminder: (id: string, updates: Partial<Reminder>) => void;
  completeReminder: (id: string) => void;
  deleteReminder: (id: string) => void;
}

interface MemorySlice {
  memories: MemoryEntry[];
  setMemories: (memories: MemoryEntry[]) => void;
}

interface SkillSlice {
  skills: Skill[];
  setSkills: (skills: Skill[]) => void;
  toggleSkill: (id: string) => void;
}

interface SettingsSlice {
  darkMode: boolean;
  notifications: boolean;
  agentName: string;
  liveVoiceEnabled: boolean;
  liveVoicePeerChannelId: string;
  setDarkMode: (enabled: boolean) => void;
  setNotifications: (enabled: boolean) => void;
  setAgentName: (name: string) => void;
  setLiveVoiceEnabled: (enabled: boolean) => void;
  setLiveVoicePeerChannelId: (channelId: string) => void;
}

type AppState = ConnectionSlice &
  ChatSlice &
  TaskSlice &
  MemorySlice &
  SkillSlice &
  SettingsSlice;

// ── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()((set) => ({
  // Connection
  status: "disconnected",
  url: resolveDefaultMobileGatewayWsUrl(),
  token: "",
  setStatus: (status) => set({ status }),
  setUrl: (url) => set({ url }),
  setToken: (token) => set({ token }),

  // Chat
  messages: [],
  isTyping: false,
  addMessage: (message) =>
    set((state) => ({ messages: [message, ...state.messages] })),
  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      ),
    })),
  setTyping: (isTyping) => set({ isTyping }),
  clearChat: () => set({ messages: [], isTyping: false }),
  loadOlderMessages: (older) =>
    set((state) => {
      const merged = [...state.messages];
      const uniqueOlder: ChatMessage[] = [];

      for (const message of older) {
        if (hasEquivalentMessage(message, merged)) {
          continue;
        }

        merged.push(message);
        uniqueOlder.push(message);
      }

      if (uniqueOlder.length === 0) {
        return state;
      }

      return { messages: merged };
    }),

  // Tasks
  reminders: [],
  addReminder: (reminder) =>
    set((state) => ({ reminders: [...state.reminders, reminder] })),
  updateReminder: (id, updates) =>
    set((state) => ({
      reminders: state.reminders.map((r) =>
        r.id === id ? { ...r, ...updates } : r,
      ),
    })),
  completeReminder: (id) =>
    set((state) => ({
      reminders: state.reminders.map((r) =>
        r.id === id ? { ...r, status: "done" as const } : r,
      ),
    })),
  deleteReminder: (id) =>
    set((state) => ({
      reminders: state.reminders.filter((r) => r.id !== id),
    })),

  // Memory
  memories: [],
  setMemories: (memories) => set({ memories }),

  // Skills
  skills: [],
  setSkills: (skills) => set({ skills }),
  toggleSkill: (id) =>
    set((state) => ({
      skills: state.skills.map((s) =>
        s.id === id ? { ...s, active: !s.active } : s,
      ),
    })),

  // Settings
  darkMode: true,
  notifications: true,
  agentName: "Karna",
  liveVoiceEnabled: false,
  liveVoicePeerChannelId: "",
  setDarkMode: (darkMode) => set({ darkMode }),
  setNotifications: (notifications) => set({ notifications }),
  setAgentName: (agentName) => set({ agentName }),
  setLiveVoiceEnabled: (liveVoiceEnabled) => set({ liveVoiceEnabled }),
  setLiveVoicePeerChannelId: (liveVoicePeerChannelId) =>
    set({ liveVoicePeerChannelId }),
}));

function hasEquivalentMessage(
  candidate: ChatMessage,
  messages: ChatMessage[],
): boolean {
  return messages.some((message) => {
    if (message.id === candidate.id) {
      return true;
    }

    if (
      message.role !== candidate.role ||
      normalizeMessageContent(message.content) !==
        normalizeMessageContent(candidate.content)
    ) {
      return false;
    }

    return (
      Math.abs(message.timestamp - candidate.timestamp) <=
      HISTORY_DUPLICATE_WINDOW_MS
    );
  });
}

function normalizeMessageContent(content: string): string {
  return content.trim();
}

// Persist on every state change (debounced)
useAppStore.subscribe((state) => {
  persistState(state as unknown as Record<string, unknown>);
});
