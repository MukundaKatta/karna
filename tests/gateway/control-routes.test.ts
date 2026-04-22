import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const transcriptState = vi.hoisted(() => ({
  transcripts: new Map<string, Array<Record<string, unknown>>>(),
}));

vi.mock("../../gateway/src/session/store.js", () => ({
  appendToTranscript: vi.fn(async (sessionId: string, message: Record<string, unknown>) => {
    const existing = transcriptState.transcripts.get(sessionId) ?? [];
    existing.push(message);
    transcriptState.transcripts.set(sessionId, existing);
  }),
  readTranscript: vi.fn(async (sessionId: string, limit?: number) => {
    const messages = [...(transcriptState.transcripts.get(sessionId) ?? [])];
    if (typeof limit === "number" && limit > 0 && messages.length > limit) {
      return messages.slice(-limit);
    }
    return messages;
  }),
  getTranscriptLength: vi.fn(async (sessionId: string) => {
    return (transcriptState.transcripts.get(sessionId) ?? []).length;
  }),
  deleteTranscript: vi.fn(async (sessionId: string) => {
    return transcriptState.transcripts.delete(sessionId);
  }),
}));

import { SessionManager } from "../../gateway/src/session/manager.js";
import { registerSessionRoutes } from "../../gateway/src/routes/sessions.js";
import { registerControlRoutes } from "../../gateway/src/routes/control.js";
import { AuditLogger } from "../../gateway/src/audit/logger.js";
import { TraceCollector } from "../../gateway/src/observability/trace-collector.js";
import {
  resetProtocolTestState,
  setOrchestratorFactoryForTests,
  type ConnectedClient,
} from "../../gateway/src/protocol/handler.js";

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

describe("control routes", () => {
  let app: ReturnType<typeof Fastify>;
  let sessionManager: SessionManager;
  let connectedClients: Map<string, ConnectedClient>;
  let auditLogger: AuditLogger;
  let traceCollector: TraceCollector;

  beforeEach(async () => {
    transcriptState.transcripts.clear();
    resetProtocolTestState();

    app = Fastify();
    sessionManager = new SessionManager({
      maxSessions: 20,
      sessionTimeoutMs: 60_000,
      flushIntervalMs: 300_000,
    });
    connectedClients = new Map();
    auditLogger = new AuditLogger();
    traceCollector = new TraceCollector();

    registerSessionRoutes(app, sessionManager, auditLogger, traceCollector);
    registerControlRoutes(app, {
      sessionManager,
      connectedClients,
      auditLogger,
      traceCollector,
    });
    await app.ready();
  });

  afterEach(async () => {
    resetProtocolTestState();
    await app.close();
  });

  it("delivers outbound messages to live sessions and channels", async () => {
    const session = sessionManager.createSession("discord-channel-1", "discord", "user-1");
    const ws = createSocket();

    connectedClients.set("discord-channel-1", {
      ws: ws as never,
      auth: null,
      sessionIds: new Set([session.id]),
      lastSeen: Date.now(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/message",
      payload: {
        channelId: "discord-channel-1",
        content: "Deployment complete",
        fromSessionId: "parent-session",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
    expect(response.json().delivered).toBe(true);
    expect(ws.sent).toHaveLength(1);
    expect(ws.sent[0]?.type).toBe("agent.response");
    expect((ws.sent[0]?.payload as Record<string, unknown>)?.content).toBe("Deployment complete");
  });

  it("spawns a session and can run an initial turn", async () => {
    setOrchestratorFactoryForTests(async () => ({
      activeAgentCount: 1,
      async init() {},
      async shutdown() {},
      setStreamCallback() {},
      setApprovalCallback() {},
      setDelegationCallback() {},
      async handleMessage() {
        return {
          success: true,
          response: "Spawned session reply",
          totalTokens: { inputTokens: 9, outputTokens: 11 },
          agentId: "karna-coder",
          delegations: [],
        };
      },
    }));

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/spawn",
      payload: {
        agentId: "karna-coder",
        channelType: "internal",
        initialMessage: "Review this repository",
        parentSessionId: "parent-1",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().success).toBe(true);
    expect(response.json().session.channelType).toBe("internal");
    expect(response.json().response).toBe("Spawned session reply");
  });

  it("soft-restarts the runtime and clears pending state", async () => {
    let shutdownCalls = 0;

    setOrchestratorFactoryForTests(async () => ({
      activeAgentCount: 1,
      async init() {},
      async shutdown() {
        shutdownCalls += 1;
      },
      setStreamCallback() {},
      setApprovalCallback() {},
      setDelegationCallback() {},
      async handleMessage() {
        return {
          success: true,
          response: "Warm start",
          totalTokens: { inputTokens: 1, outputTokens: 1 },
          agentId: "karna-general",
          delegations: [],
        };
      },
    }));

    await app.inject({
      method: "POST",
      url: "/api/sessions/spawn",
      payload: {
        agentId: "karna-general",
        channelType: "internal",
        initialMessage: "Initialize runtime",
      },
    });

    const restart = await app.inject({
      method: "POST",
      url: "/api/restart",
      payload: {
        requestedBy: "test-suite",
        reason: "verify soft restart",
      },
    });

    expect(restart.statusCode).toBe(200);
    expect(restart.json().success).toBe(true);
    expect(restart.json().hadActiveOrchestrator).toBe(true);
    expect(shutdownCalls).toBe(1);
  });
});
