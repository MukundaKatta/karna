import Fastify from "fastify";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseRouteLogLevels,
  redactRecord,
  registerRequestLogging,
  rotateLogFileIfNeeded,
} from "../../gateway/src/middleware/request-logging.js";

describe("gateway request logging middleware", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("propagates request IDs and logs REST response metadata", async () => {
    const app = Fastify({ logger: false });
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    let now = 1_000;

    registerRequestLogging(app, {
      logger: logger as never,
      now: () => {
        now += 25;
        return now;
      },
    });
    app.get("/api/test", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/api/test?apiKey=secret",
      headers: {
        "x-request-id": "req-123",
        authorization: "Bearer token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("req-123");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-123",
        method: "GET",
        path: "/api/test",
        statusCode: 200,
        durationMs: 25,
        request: expect.objectContaining({
          headers: expect.objectContaining({ authorization: "[redacted]" }),
          query: expect.objectContaining({ apiKey: "[redacted]" }),
        }),
      }),
      "REST request completed",
    );

    await app.close();
  });

  it("redacts nested sensitive fields", () => {
    expect(
      redactRecord({
        token: "secret",
        nested: {
          api_key: "secret",
          safe: "value",
        },
      }),
    ).toEqual({
      token: "[redacted]",
      nested: {
        api_key: "[redacted]",
        safe: "value",
      },
    });
  });

  it("parses route log-level overrides", () => {
    expect(parseRouteLogLevels('{"/health":"debug","/api":"warn","/bad":"trace"}')).toEqual({
      "/health": "debug",
      "/api": "warn",
    });
    expect(parseRouteLogLevels("not json")).toBeUndefined();
  });

  it("rotates oversized log files", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "karna-request-logs-"));
    const logPath = join(tempDir, "gateway.log");
    await writeFile(logPath, "1234567890");

    expect(rotateLogFileIfNeeded(logPath, 5)).toBe(true);
    await expect(readFile(logPath, "utf-8")).rejects.toThrow();
  });
});
