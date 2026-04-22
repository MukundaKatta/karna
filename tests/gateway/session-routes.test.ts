import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { SessionManager } from "../../gateway/src/session/manager.js";
import { registerSessionRoutes } from "../../gateway/src/routes/sessions.js";

describe("session routes", () => {
  let app: ReturnType<typeof Fastify>;
  let sessionManager: SessionManager;

  beforeEach(async () => {
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
    await app.close();
  });

  it("lists and summarizes filtered sessions", async () => {
    const telegram = sessionManager.createSession("agent-1", "telegram", "user-1");
    const discord = sessionManager.createSession("agent-2", "discord", "user-2");
    sessionManager.updateSessionStatus(discord.id, "suspended");
    sessionManager.getSession(telegram.id)!.updatedAt = Date.now() - 120_000;

    const list = await app.inject({
      method: "GET",
      url: "/api/sessions?channelType=telegram",
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().sessions).toHaveLength(1);
    expect(list.json().sessions[0].id).toBe(telegram.id);

    const summary = await app.inject({
      method: "GET",
      url: "/api/sessions/summary?staleAfterMs=60000",
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().summary.total).toBe(2);
    expect(summary.json().summary.staleSessions).toBe(1);
    expect(summary.json().summary.byStatus.suspended).toBe(1);
  });

  it("retrieves, updates, and terminates individual sessions", async () => {
    const session = sessionManager.createSession("agent-1", "telegram", "user-1");

    const get = await app.inject({
      method: "GET",
      url: `/api/sessions/${session.id}`,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().session.id).toBe(session.id);

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${session.id}`,
      payload: { status: "suspended" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().session.status).toBe("suspended");

    const invalidTerminatePatch = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${session.id}`,
      payload: { status: "terminated" },
    });
    expect(invalidTerminatePatch.statusCode).toBe(400);

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${session.id}`,
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().removed).toBe(true);
  });

  it("requires a filter or all=true for bulk termination", async () => {
    sessionManager.createSession("agent-1", "telegram", "user-1");
    sessionManager.createSession("agent-2", "discord", "user-2");

    const unsafe = await app.inject({
      method: "DELETE",
      url: "/api/sessions",
    });
    expect(unsafe.statusCode).toBe(400);

    const filtered = await app.inject({
      method: "DELETE",
      url: "/api/sessions?channelType=telegram",
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().removed).toBe(1);

    const removeAll = await app.inject({
      method: "DELETE",
      url: "/api/sessions?all=true",
    });
    expect(removeAll.statusCode).toBe(200);
    expect(removeAll.json().removed).toBe(1);
  });
});
