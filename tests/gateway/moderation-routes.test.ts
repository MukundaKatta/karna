import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerModerationRoutes } from "../../gateway/src/routes/moderation.js";
import { logModerationEvent } from "../../gateway/src/security/moderation.js";

describe("moderation routes", () => {
  let app: ReturnType<typeof Fastify>;
  let dir: string;
  const originalLogDir = process.env["KARNA_MODERATION_LOG_DIR"];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "karna-moderation-routes-"));
    process.env["KARNA_MODERATION_LOG_DIR"] = dir;
    app = Fastify();
    registerModerationRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
    if (originalLogDir === undefined) {
      delete process.env["KARNA_MODERATION_LOG_DIR"];
    } else {
      process.env["KARNA_MODERATION_LOG_DIR"] = originalLogDir;
    }
  });

  it("records user reports and returns review queue items", async () => {
    const report = await app.inject({
      method: "POST",
      url: "/api/moderation/reports",
      payload: {
        sessionId: "session-1",
        messageId: "message-1",
        reason: "unsafe",
        details: "User flagged this response",
        reporterId: "user-1",
        content: "<script>alert(1)</script>",
      },
    });

    expect(report.statusCode).toBe(201);
    expect(report.json().report.contentHash).toBeTruthy();

    const list = await app.inject({ method: "GET", url: "/api/moderation" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0]).toMatchObject({
      kind: "reported",
      sessionId: "session-1",
      messageId: "message-1",
      reasons: ["unsafe"],
    });
  });

  it("lists filtered moderation events for admin review", async () => {
    await logModerationEvent({
      sessionId: "session-2",
      level: "strict",
      reasons: ["pii_leakage"],
      originalContentHash: "hash",
      replacementContent: "safe",
      timestamp: Date.now(),
    });

    const list = await app.inject({ method: "GET", url: "/api/moderation" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0]).toMatchObject({
      kind: "filtered",
      sessionId: "session-2",
      reasons: ["pii_leakage"],
    });
  });
});
