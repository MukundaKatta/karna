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
  cacheDirectory: "file:///tmp/cache/",
  EncodingType: {
    Base64: "base64",
  },
  getInfoAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(async () => undefined),
}));

vi.mock("expo-av", () => ({
  Audio: {
    AndroidOutputFormat: {
      MPEG_4: "mpeg4",
    },
    AndroidAudioEncoder: {
      AAC: "aac",
    },
    IOSAudioQuality: {
      HIGH: "high",
    },
    IOSOutputFormat: {
      MPEG4AAC: "mpeg4aac",
    },
    requestPermissionsAsync: vi.fn(),
    setAudioModeAsync: vi.fn(),
    Recording: {
      createAsync: vi.fn(),
    },
    Sound: {
      createAsync: vi.fn(),
    },
  },
}));

type TestGatewayClient = {
  handleProtocolMessage: (message: {
    type: string;
    id?: string;
    timestamp?: number;
    sessionId?: string;
    payload?: Record<string, unknown>;
  }) => void;
  respondToToolApproval: (
    toolCallId: string,
    approved: boolean,
    options?: { approveAllForSession?: boolean; reason?: string },
  ) => void;
  sessionId: string | null;
  pendingStreamMessageId: string | null;
};

describe("mobile gateway client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("__DEV__", false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stores tool approval requests for explicit mobile user approval", async () => {
    const { gatewayClient } =
      await import("../../apps/mobile/lib/gateway-client.js");
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");
    const client = gatewayClient as unknown as TestGatewayClient;
    const send = vi.spyOn(gatewayClient, "send").mockImplementation(() => {});

    useAppStore.setState({ messages: [], isTyping: true });
    useAppStore.getState().addMessage({
      id: "assistant-1",
      role: "assistant",
      content: "I need to inspect something.",
      timestamp: 1_800_000_000_000,
    });
    client.sessionId = "mobile-session-1";
    client.pendingStreamMessageId = "assistant-1";

    client.handleProtocolMessage({
      id: "approval-message-1",
      type: "tool.approval.requested",
      timestamp: Date.now(),
      sessionId: "mobile-session-1",
      payload: {
        toolCallId: "tool-1",
        toolName: "shell_exec",
        arguments: { command: "ls -R" },
        riskLevel: "medium",
      },
    });

    expect(send).not.toHaveBeenCalled();
    expect(useAppStore.getState().pendingToolApproval).toMatchObject({
      toolCallId: "tool-1",
      toolName: "shell_exec",
      riskLevel: "medium",
      arguments: { command: "ls -R" },
    });
  });

  it("sends the user's tool approval decision", async () => {
    const { gatewayClient } =
      await import("../../apps/mobile/lib/gateway-client.js");
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");
    const client = gatewayClient as unknown as TestGatewayClient;
    const send = vi.spyOn(gatewayClient, "send").mockImplementation(() => {});

    useAppStore.setState({
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "I need to inspect something.",
          timestamp: 1_800_000_000_000,
        },
      ],
      pendingToolApproval: {
        toolCallId: "tool-1",
        toolName: "shell_exec",
        riskLevel: "high",
        arguments: { command: "ls -R" },
        requestedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
    });
    client.sessionId = "mobile-session-1";

    client.respondToToolApproval("tool-1", true, {
      approveAllForSession: true,
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool.approval.response",
        sessionId: "mobile-session-1",
        payload: expect.objectContaining({
          toolCallId: "tool-1",
          approved: true,
        }),
      }),
    );
    expect(useAppStore.getState().pendingToolApproval).toBeNull();
    expect(useAppStore.getState().messages[0]?.toolCalls?.[0]).toMatchObject({
      id: "tool-1",
      name: "shell_exec",
      status: "success",
      input: { command: "ls -R" },
    });
  });

  it("batches streaming deltas and clears streaming state on finish", async () => {
    const { gatewayClient } =
      await import("../../apps/mobile/lib/gateway-client.js");
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");
    const client = gatewayClient as unknown as TestGatewayClient;

    useAppStore.setState({ messages: [] });

    client.handleProtocolMessage({
      id: "stream-1",
      type: "agent.response.stream",
      timestamp: Date.now(),
      payload: { delta: "Hel", index: 0, finishReason: null },
    });
    client.handleProtocolMessage({
      id: "stream-1",
      type: "agent.response.stream",
      timestamp: Date.now(),
      payload: { delta: "lo", index: 1, finishReason: null },
    });

    expect(useAppStore.getState().messages[0]).toMatchObject({
      id: "stream-1",
      content: "",
      isStreaming: true,
    });

    await vi.advanceTimersByTimeAsync(50);
    expect(useAppStore.getState().messages[0]).toMatchObject({
      content: "Hello",
      isStreaming: true,
    });

    client.handleProtocolMessage({
      id: "stream-1",
      type: "agent.response.stream",
      timestamp: Date.now(),
      payload: { delta: "!", index: 2, finishReason: "stop" },
    });

    expect(useAppStore.getState().messages[0]).toMatchObject({
      content: "Hello!",
      isStreaming: false,
    });
  });
});
