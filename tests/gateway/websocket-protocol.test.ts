import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../gateway/src/session/manager.js";
vi.mock("../../gateway/src/voice/handler.js", () => ({
  handleVoiceStart: vi.fn(),
  handleVoiceAudioChunk: vi.fn(),
  handleVoiceEnd: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@karna/agent/orchestration/orchestrator.js", () => ({
  Orchestrator: class {},
}));
import {
  handleMessage,
  resetProtocolTestState,
  setOrchestratorFactoryForTests,
  type ConnectionContext,
} from "../../gateway/src/protocol/handler.js";
import { createAuthContext } from "../../gateway/src/protocol/auth.js";
import { appendToTranscript, readTranscript } from "../../gateway/src/session/store.js";

vi.mock("../../gateway/src/session/store.js", () => ({
  appendToTranscript: vi.fn().mockResolvedValue(undefined),
  readTranscript: vi.fn().mockResolvedValue([]),
}));

function createSocket() {
  const sent: Record<string, unknown>[] = [];
  return {
    OPEN: 1,
    readyState: 1,
    sent,
    send(payload: string) {
      sent.push(JSON.parse(payload));
    },
  };
}

function createContext(overrides?: Partial<ConnectionContext>): ConnectionContext {
  const sessionManager = overrides?.sessionManager ?? new SessionManager({ flushIntervalMs: 300_000 });
  return {
    ws: overrides?.ws ?? (createSocket() as never),
    auth: overrides?.auth ?? null,
    sessionManager,
    heartbeatScheduler: overrides?.heartbeatScheduler ?? ({ stopAll() {} } as never),
    connectedClients: overrides?.connectedClients ?? new Map(),
  };
}

describe("gateway websocket protocol", () => {
  const originalNodeEnv = process.env["NODE_ENV"];
  const originalGatewayToken = process.env["GATEWAY_AUTH_TOKEN"];

  beforeEach(() => {
    vi.clearAllMocks();
    resetProtocolTestState();
    delete process.env["GATEWAY_AUTH_TOKEN"];
    process.env["NODE_ENV"] = "test";
  });

  afterEach(() => {
    resetProtocolTestState();
    if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = originalNodeEnv;
    if (originalGatewayToken === undefined) delete process.env["GATEWAY_AUTH_TOKEN"];
    else process.env["GATEWAY_AUTH_TOKEN"] = originalGatewayToken;
  });

  it("acknowledges a connect message and creates a session", async () => {
    const ws = createSocket();
    const context = createContext({ ws: ws as never });

    await handleMessage(
      ws as never,
      {
        id: "msg-connect",
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "webchat",
          channelId: "device-1",
          metadata: { userId: "user-1" },
        },
      },
      context,
    );

    expect(ws.sent[0]?.type).toBe("connect.ack");
    expect(context.sessionManager.activeSessionCount).toBe(1);
    expect(context.connectedClients.size).toBe(1);
  });

  it("returns an auth challenge when production auth is not satisfied", async () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["GATEWAY_AUTH_TOKEN"];

    const ws = createSocket();
    const context = createContext({ ws: ws as never });

    await handleMessage(
      ws as never,
      {
        id: "msg-connect",
        type: "connect",
        timestamp: Date.now(),
        payload: {
          channelType: "webchat",
          channelId: "device-2",
          metadata: {},
        },
      },
      context,
    );

    expect(ws.sent[0]?.type).toBe("connect.challenge");
  });

  it("rejects chat messages before connect", async () => {
    const ws = createSocket();
    const context = createContext({ ws: ws as never });

    await handleMessage(
      ws as never,
      {
        id: "msg-chat",
        type: "chat.message",
        timestamp: Date.now(),
        sessionId: "missing-session",
        payload: {
          role: "user",
          content: "hello",
        },
      },
      context,
    );

    expect(ws.sent.at(-1)?.type).toBe("error");
    expect((ws.sent.at(-1)?.payload as Record<string, unknown>)?.code).toBe("UNAUTHENTICATED");
  });

  it("routes authenticated chat messages through the orchestrator and streams results", async () => {
    const ws = createSocket();
    const context = createContext({ ws: ws as never });
    const session = context.sessionManager.createSession("agent-1", "webchat", "user-1");
    context.auth = createAuthContext("device-1", "operator", "token");

    setOrchestratorFactoryForTests(async () => {
      let streamCallback: ((event: { type: "text" | "tool_use"; text?: string; id?: string; name?: string; input?: unknown }) => void) | null = null;
      let delegationCallback: ((record: {
        fromAgentId: string;
        toAgentId: string;
        reason: string;
        task: string;
        timestamp: number;
      }) => void) | null = null;

      return {
        activeAgentCount: 2,
        async init() {},
        setStreamCallback(callback) {
          streamCallback = callback;
        },
        setApprovalCallback(_callback) {},
        setDelegationCallback(callback) {
          delegationCallback = callback;
        },
        async handleMessage() {
          streamCallback?.({ type: "text", text: "Partial reply" });
          delegationCallback?.({
            fromAgentId: "karna-general",
            toAgentId: "karna-coder",
            reason: "Needs code help",
            task: "Review code",
            timestamp: Date.now(),
          });
          return {
            success: true,
            response: "Final reply",
            totalTokens: { inputTokens: 10, outputTokens: 20 },
            agentId: "karna-coder",
            delegations: [
              {
                fromAgentId: "karna-general",
                toAgentId: "karna-coder",
                reason: "Needs code help",
                task: "Review code",
                timestamp: Date.now(),
              },
            ],
          };
        },
      };
    });

    await handleMessage(
      ws as never,
      {
        id: "msg-chat",
        type: "chat.message",
        timestamp: Date.now(),
        sessionId: session.id,
        payload: {
          role: "user",
          content: "Please help with code",
        },
      },
      context,
    );

    const sentTypes = ws.sent.map((message) => message.type);
    expect(sentTypes).toContain("status");
    expect(sentTypes).toContain("agent.response.stream");
    expect(sentTypes).toContain("agent.handoff");
    expect(sentTypes).toContain("agent.response");
    expect(sentTypes).toContain("orchestration.status");

    expect(appendToTranscript).toHaveBeenCalledTimes(2);
    expect(readTranscript).toHaveBeenCalledWith(session.id, 50);
  });
});
