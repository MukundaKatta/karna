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

  it("denies tool approval requests immediately so mobile turns do not hang", async () => {
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

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool.approval.response",
        sessionId: "mobile-session-1",
        payload: expect.objectContaining({
          toolCallId: "tool-1",
          approved: false,
        }),
      }),
    );
    expect(useAppStore.getState().isTyping).toBe(false);
    expect(useAppStore.getState().messages[0]).toMatchObject({
      role: "system",
      content:
        "Karna requested the shell_exec tool. Mobile denied it for safety because tool approvals are not available in the app yet.",
    });
    expect(useAppStore.getState().messages[1]?.toolCalls?.[0]).toMatchObject({
      id: "tool-1",
      name: "shell_exec",
      status: "error",
      input: { command: "ls -R" },
    });
  });
});
