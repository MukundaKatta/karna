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
import {
  resetProtocolTestState,
  setOrchestratorFactoryForTests,
} from "../../gateway/src/protocol/handler.js";

describe("session transcript routes", () => {
  let app: ReturnType<typeof Fastify>;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    transcriptState.transcripts.clear();
    resetProtocolTestState();
    app = Fastify();
    sessionManager = new SessionManager({
      maxSessions: 20,
      sessionTimeoutMs: 60_000,
      flushIntervalMs: 300_000,
    });
    registerSessionRoutes(app, sessionManager);
    await app.ready();
  });

  afterEach(async () => {
    resetProtocolTestState();
    await app.close();
  });

  it("returns limited transcript history and supports clearing it", async () => {
    const session = sessionManager.createSession("agent-1", "telegram", "user-1");

    await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/message`,
      payload: { content: "first note" },
    });
    await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/message`,
      payload: { content: "second note" },
    });

    const history = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/history?limit=1`,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().messages).toHaveLength(1);
    expect(history.json().messages[0].content).toBe("second note");
    expect(history.json().totalMessages).toBe(2);
    expect(history.json().hasMore).toBe(true);

    const clear = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}/history`,
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json().cleared).toBe(true);

    const afterClear = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/history`,
    });
    expect(afterClear.statusCode).toBe(200);
    expect(afterClear.json().messages).toHaveLength(0);
    expect(afterClear.json().totalMessages).toBe(0);
  });

  it("can inject a reply-back message and return the agent response", async () => {
    setOrchestratorFactoryForTests(async () => ({
      activeAgentCount: 1,
      async init() {},
      setStreamCallback() {},
      setApprovalCallback() {},
      setDelegationCallback() {},
      async handleMessage() {
        return {
          success: true,
          response: "Injected reply",
          totalTokens: { inputTokens: 12, outputTokens: 34 },
          agentId: "karna-general",
          delegations: [],
        };
      },
    }));

    const session = sessionManager.createSession("agent-1", "telegram", "user-1");
    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/message`,
      payload: {
        content: "Please respond",
        role: "system",
        replyBack: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().success).toBe(true);
    expect(response.json().queued).toBe(false);
    expect(response.json().response).toBe("Injected reply");
    expect(response.json().usage.inputTokens).toBe(12);

    const history = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}/history`,
    });
    expect(history.json().messages).toHaveLength(2);
    expect(history.json().messages[1].role).toBe("assistant");
    expect(sessionManager.getSession(session.id)?.stats?.messageCount).toBe(1);
  });

  it("rejects invalid injected message roles", async () => {
    const session = sessionManager.createSession("agent-1", "telegram", "user-1");

    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${session.id}/message`,
      payload: {
        content: "bad role",
        role: "moderator",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
