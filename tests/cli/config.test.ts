import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfigWithStatus,
  resolveGatewayHttpUrl,
  resolveGatewayPort,
  resolveGatewayWsUrl,
} from "../../apps/cli/src/lib/config.js";

describe("CLI config helpers", () => {
  const originalConfig = process.env["KARNA_CONFIG"];
  const originalGatewayPort = process.env["GATEWAY_PORT"];
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "karna-cli-config-"));
    delete process.env["GATEWAY_PORT"];
  });

  afterEach(() => {
    if (originalConfig === undefined) delete process.env["KARNA_CONFIG"];
    else process.env["KARNA_CONFIG"] = originalConfig;

    if (originalGatewayPort === undefined) delete process.env["GATEWAY_PORT"];
    else process.env["GATEWAY_PORT"] = originalGatewayPort;

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loads config and resolves local gateway URLs from the config file", async () => {
    const configPath = join(tempDir, "karna.json");
    process.env["KARNA_CONFIG"] = configPath;

    writeFileSync(
      configPath,
      JSON.stringify({
        name: "karna",
        env: "development",
        gateway: {
          port: 3456,
          host: "0.0.0.0",
          cors: { origins: ["*"], credentials: true },
          websocket: {
            path: "/ws",
            heartbeatIntervalMs: 30_000,
            heartbeatTimeoutMs: 10_000,
            maxPayloadBytes: 1_048_576,
            maxConnectionsPerIp: 10,
          },
          rateLimit: {
            windowMs: 60_000,
            maxRequests: 60,
          },
        },
        agent: {
          defaultModel: "claude-sonnet-4-20250514",
          maxTokens: 4096,
          temperature: 0.7,
          maxTurns: 20,
          toolApproval: {
            autoApproveBelow: "low",
            timeoutMs: 120_000,
          },
        },
        channels: [],
        memory: {
          enabled: true,
          backend: "sqlite",
          maxEntriesPerSession: 1000,
          embedding: {
            enabled: false,
            model: "text-embedding-3-small",
            dimensions: 1536,
          },
        },
        logging: {
          level: "info",
          pretty: true,
          redact: ["*.apiKey"],
        },
        skills: {
          directory: "./skills",
          autoLoad: true,
        },
      }),
      "utf-8",
    );

    const loaded = await loadConfigWithStatus();

    expect(loaded.config?.gateway.port).toBe(3456);
    expect(await resolveGatewayPort()).toBe("3456");
    expect(await resolveGatewayHttpUrl()).toBe("http://localhost:3456");
    expect(await resolveGatewayWsUrl()).toBe("ws://localhost:3456/ws");
  });

  it("lets GATEWAY_PORT override the configured port", async () => {
    process.env["GATEWAY_PORT"] = "9999";
    expect(await resolveGatewayPort()).toBe("9999");
  });
});
