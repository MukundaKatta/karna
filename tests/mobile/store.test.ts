import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});
