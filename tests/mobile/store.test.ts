import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

vi.mock("expo-file-system", () => ({
  documentDirectory: "file:///tmp/",
  getInfoAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(async () => undefined),
}));

describe("mobile store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("__DEV__", false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not duplicate live messages when session history returns them", async () => {
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");
    const now = 1_800_000_000_000;

    useAppStore.setState({ messages: [] });
    useAppStore.getState().addMessage({
      id: "local-user",
      role: "user",
      content: "Reply with exactly: Karna E2E OK.",
      timestamp: now,
    });
    useAppStore.getState().addMessage({
      id: "local-assistant",
      role: "assistant",
      content: "Karna E2E OK.",
      timestamp: now + 500,
    });

    useAppStore.getState().loadOlderMessages([
      {
        id: "server-assistant",
        role: "assistant",
        content: "Karna E2E OK.",
        timestamp: now + 700,
      },
      {
        id: "server-user",
        role: "user",
        content: "Reply with exactly: Karna E2E OK.",
        timestamp: now + 200,
      },
      {
        id: "older-message",
        role: "user",
        content: "Earlier real message",
        timestamp: now - 300_000,
      },
    ]);

    expect(useAppStore.getState().messages).toHaveLength(3);
    expect(
      useAppStore
        .getState()
        .messages.filter((message) => message.content === "Karna E2E OK."),
    ).toHaveLength(1);
    expect(
      useAppStore
        .getState()
        .messages.some((message) => message.content === "Earlier real message"),
    ).toBe(true);
  });

  it("keeps repeated messages when they are outside the live duplicate window", async () => {
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");
    const now = 1_800_000_000_000;

    useAppStore.setState({ messages: [] });
    useAppStore.getState().addMessage({
      id: "current",
      role: "user",
      content: "status",
      timestamp: now,
    });
    useAppStore.getState().loadOlderMessages([
      {
        id: "older",
        role: "user",
        content: "status",
        timestamp: now - 300_000,
      },
    ]);

    expect(useAppStore.getState().messages).toHaveLength(2);
  });

  it("updates, clears, and caps chat messages at the newest 100", async () => {
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");

    useAppStore.getState().setTyping(true);
    for (let index = 0; index < 105; index += 1) {
      useAppStore.getState().addMessage({
        id: `message-${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message ${index}`,
        timestamp: index,
      });
    }

    expect(useAppStore.getState().messages).toHaveLength(100);
    expect(useAppStore.getState().messages[0]?.id).toBe("message-104");
    expect(useAppStore.getState().messages.at(-1)?.id).toBe("message-5");

    useAppStore
      .getState()
      .updateMessage("message-104", { content: "updated" });
    expect(useAppStore.getState().messages[0]?.content).toBe("updated");

    useAppStore.getState().clearChat();
    expect(useAppStore.getState().messages).toEqual([]);
    expect(useAppStore.getState().isTyping).toBe(false);
  });

  it("keeps only the newest messages when loading older history", async () => {
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");

    for (let index = 0; index < 95; index += 1) {
      useAppStore.getState().addMessage({
        id: `live-${index}`,
        role: "user",
        content: `live ${index}`,
        timestamp: 2_000 + index,
      });
    }

    useAppStore.getState().loadOlderMessages(
      Array.from({ length: 10 }, (_, index) => ({
        id: `older-${index}`,
        role: "assistant" as const,
        content: `older ${index}`,
        timestamp: index,
      })),
    );

    expect(useAppStore.getState().messages).toHaveLength(100);
    expect(useAppStore.getState().messages.at(-1)?.id).toBe("older-4");
    expect(
      useAppStore.getState().messages.some((message) => message.id === "older-9"),
    ).toBe(false);
  });

  it("manages reminder lifecycle state", async () => {
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");

    useAppStore.getState().addReminder({
      id: "reminder-1",
      title: "Ship issue fix",
      status: "pending",
      createdAt: 100,
    });
    useAppStore.getState().updateReminder("reminder-1", {
      description: "Add focused tests",
      status: "in-progress",
    });
    useAppStore.getState().completeReminder("reminder-1");

    expect(useAppStore.getState().reminders).toEqual([
      {
        id: "reminder-1",
        title: "Ship issue fix",
        description: "Add focused tests",
        status: "done",
        createdAt: 100,
      },
    ]);

    useAppStore.getState().deleteReminder("reminder-1");
    expect(useAppStore.getState().reminders).toEqual([]);
  });

  it("stores memories and supports category/query filtering by consumers", async () => {
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");

    useAppStore.getState().setMemories([
      {
        id: "memory-1",
        content: "Prefers concise release notes",
        category: "preference",
        importance: 0.7,
        createdAt: 100,
      },
      {
        id: "memory-2",
        content: "Follow up on deployment",
        category: "task",
        importance: 0.5,
        createdAt: 200,
      },
    ]);
    useAppStore.getState().setMemorySearchQuery("release");

    const filtered = useAppStore
      .getState()
      .memories.filter(
        (memory) =>
          memory.category === "preference" &&
          memory.content
            .toLowerCase()
            .includes(useAppStore.getState().memorySearchQuery),
      );

    expect(filtered.map((memory) => memory.id)).toEqual(["memory-1"]);
  });

  it("sets and toggles skills", async () => {
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");

    useAppStore.getState().setSkills([
      {
        id: "weather",
        name: "Weather",
        description: "Forecasts",
        icon: "cloud",
        active: false,
        version: "1.0.0",
      },
      {
        id: "calendar",
        name: "Calendar",
        description: "Events",
        icon: "calendar",
        active: true,
        version: "1.0.0",
      },
    ]);
    useAppStore.getState().toggleSkill("weather");

    expect(useAppStore.getState().skills).toMatchObject([
      { id: "weather", active: true },
      { id: "calendar", active: true },
    ]);
  });

  it("updates connection and settings slices", async () => {
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");

    useAppStore.getState().setStatus("connected");
    useAppStore.getState().setUrl("wss://gateway.example.test/ws");
    useAppStore.getState().setToken("token-123");
    useAppStore.getState().setDarkMode(false);
    useAppStore.getState().setNotifications(false);
    useAppStore.getState().setHapticsEnabled(false);
    useAppStore.getState().setAgentName("BriefBench");
    useAppStore.getState().setLiveVoiceEnabled(true);
    useAppStore.getState().setLiveVoicePeerChannelId("voice-channel");
    useAppStore.getState().setAuthCallbackCode("callback-code");

    expect(useAppStore.getState()).toMatchObject({
      status: "connected",
      url: "wss://gateway.example.test/ws",
      token: "token-123",
      darkMode: false,
      notifications: false,
      hapticsEnabled: false,
      agentName: "BriefBench",
      liveVoiceEnabled: true,
      liveVoicePeerChannelId: "voice-channel",
      authCallbackCode: "callback-code",
    });
  });

  it("flushes messages immediately while keeping other store keys persisted", async () => {
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");
    const fileSystem = await import("expo-file-system");
    const writeAsStringAsync = fileSystem.writeAsStringAsync as Mock;
    writeAsStringAsync.mockClear();

    useAppStore.getState().setAgentName("Ada");
    useAppStore.getState().setHapticsEnabled(false);
    useAppStore.getState().setChatDraft("draft reply");
    useAppStore.getState().addMessage({
      id: "message-1",
      role: "user",
      content: "hello",
      timestamp: 1,
    });

    expect(writeAsStringAsync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);

    expect(writeAsStringAsync).toHaveBeenCalledTimes(1);
    const [, raw] = writeAsStringAsync.mock.calls[0] as [string, string];
    const persisted = JSON.parse(raw) as Record<string, unknown>;

    expect(persisted).toMatchObject({
      agentName: "Ada",
      hapticsEnabled: false,
      chatDraft: "draft reply",
      messages: [
        {
          id: "message-1",
          role: "user",
          content: "hello",
          timestamp: 1,
        },
      ],
    });
    expect(persisted).not.toHaveProperty("isTyping");
  });

  it("persists message updates and chat clears without waiting for debounce", async () => {
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");
    const fileSystem = await import("expo-file-system");
    const writeAsStringAsync = fileSystem.writeAsStringAsync as Mock;
    writeAsStringAsync.mockClear();

    useAppStore.getState().addMessage({
      id: "streaming-message",
      role: "assistant",
      content: "hel",
      timestamp: 1,
    });
    useAppStore
      .getState()
      .updateMessage("streaming-message", { content: "hello" });
    useAppStore.getState().clearChat();

    expect(writeAsStringAsync).toHaveBeenCalledTimes(3);
    const [, updatedRaw] = writeAsStringAsync.mock.calls[1] as [string, string];
    expect(JSON.parse(updatedRaw).messages[0]).toMatchObject({
      id: "streaming-message",
      content: "hello",
    });

    const [, clearedRaw] = writeAsStringAsync.mock.calls[2] as [string, string];
    expect(JSON.parse(clearedRaw).messages).toEqual([]);

    await vi.advanceTimersByTimeAsync(500);
    expect(writeAsStringAsync).toHaveBeenCalledTimes(3);
  });

  it("hydrates persisted state and rewrites legacy local gateway urls", async () => {
    const fileSystem = await import("expo-file-system");
    const getInfoAsync = fileSystem.getInfoAsync as Mock;
    const readAsStringAsync = fileSystem.readAsStringAsync as Mock;

    getInfoAsync.mockResolvedValue({ exists: true });
    readAsStringAsync.mockResolvedValue(
      JSON.stringify({
        darkMode: false,
        notifications: false,
        agentName: "Persisted",
        url: "ws://localhost:3100",
        token: "persisted-token",
        chatDraft: "persisted draft",
        reminders: [
          {
            id: "reminder-1",
            title: "Hydrated",
            status: "pending",
            createdAt: 100,
          },
        ],
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "restored",
            timestamp: 1,
          },
        ],
      }),
    );

    const { loadPersistedState, useAppStore } = await import(
      "../../apps/mobile/lib/store.js"
    );
    await loadPersistedState();

    expect(useAppStore.getState()).toMatchObject({
      darkMode: false,
      notifications: false,
      agentName: "Persisted",
      token: "persisted-token",
      chatDraft: "persisted draft",
    });
    expect(useAppStore.getState().url).toBe("wss://karna-gateway.onrender.com/ws");
    expect(useAppStore.getState().messages).toHaveLength(1);
    expect(useAppStore.getState().reminders).toHaveLength(1);
  });
});
