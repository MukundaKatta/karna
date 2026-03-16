import { create } from 'zustand';

// ── Types ────────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  input?: Record<string, unknown>;
  output?: string;
  duration?: number;
}

export interface Reminder {
  id: string;
  title: string;
  description?: string;
  dueDate?: number;
  status: 'pending' | 'in-progress' | 'done';
  createdAt: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  category: 'fact' | 'preference' | 'event' | 'task';
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
  setDarkMode: (enabled: boolean) => void;
  setNotifications: (enabled: boolean) => void;
  setAgentName: (name: string) => void;
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
  status: 'disconnected',
  url: 'ws://localhost:3100',
  token: '',
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
    set((state) => ({ messages: [...state.messages, ...older] })),

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
        r.id === id ? { ...r, status: 'done' as const } : r,
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
  agentName: 'Karna',
  setDarkMode: (darkMode) => set({ darkMode }),
  setNotifications: (notifications) => set({ notifications }),
  setAgentName: (agentName) => set({ agentName }),
}));
