import { describe, it, expect } from "vitest";
import {
  KarnaConfigSchema,
  GatewayConfigSchema,
  ModelConfigSchema,
} from "../../gateway/src/config/schema.js";

describe("Configuration Validation - Security", () => {
  it("CORS defaults to empty origins array (must be configured explicitly)", () => {
    const config = GatewayConfigSchema.parse({});
    expect(config.cors.origins).toEqual([]);
  });

  it("authToken is optional (dev-only concern)", () => {
    const config = GatewayConfigSchema.parse({});
    expect(config.authToken).toBeUndefined();
    // NOTE: Should be mandatory in production
  });

  it("heartbeat interval has minimum value", () => {
    const result = GatewayConfigSchema.safeParse({ heartbeatIntervalMs: 0 });
    expect(result.success).toBe(false);
  });

  it("session timeout has minimum value", () => {
    const result = GatewayConfigSchema.safeParse({ sessionTimeoutMs: 0 });
    expect(result.success).toBe(false);
  });

  it("model cost cannot be negative", () => {
    expect(
      ModelConfigSchema.safeParse({
        provider: "anthropic",
        model: "test",
        costPer1kInput: -1,
      }).success,
    ).toBe(false);
  });

  it("full config with all fields validates", () => {
    const fullConfig = {
      gateway: {
        port: 8080,
        host: "localhost",
        authToken: "my-token",
        maxConnections: 500,
        heartbeatIntervalMs: 15_000,
        sessionTimeoutMs: 1_800_000,
        cors: { origins: ["https://myapp.com"] },
      },
      agent: {
        defaultModel: "claude-opus-4-20250514",
        maxTokens: 16384,
        temperature: 0.5,
        systemPrompt: "You are Karna.",
        workspacePath: "/tmp/workspace",
      },
      channels: [
        { type: "telegram", enabled: true, config: { token: "123" } },
        { type: "discord", enabled: false },
      ],
      models: {
        primary: {
          provider: "anthropic" as const,
          model: "claude-sonnet-4-20250514",
          costPer1kInput: 0.003,
          costPer1kOutput: 0.015,
        },
      },
    };

    const result = KarnaConfigSchema.safeParse(fullConfig);
    expect(result.success).toBe(true);
  });
});
