import { describe, it, expect } from "vitest";
import {
  GatewayConfigSchema,
  AgentConfigSchema,
  ChannelConfigSchema,
  ModelConfigSchema,
  KarnaConfigSchema,
} from "../../gateway/src/config/schema.js";

describe("Config Schema", () => {
  describe("GatewayConfigSchema", () => {
    it("provides sensible defaults", () => {
      const config = GatewayConfigSchema.parse({});
      expect(config.port).toBe(18789);
      expect(config.host).toBe("0.0.0.0");
      expect(config.maxConnections).toBe(100);
      expect(config.heartbeatIntervalMs).toBe(30_000);
      expect(config.sessionTimeoutMs).toBe(3_600_000);
      expect(config.cors.origins).toEqual([]);
    });

    it("validates port is positive integer", () => {
      expect(GatewayConfigSchema.safeParse({ port: -1 }).success).toBe(false);
      expect(GatewayConfigSchema.safeParse({ port: 0 }).success).toBe(false);
      expect(GatewayConfigSchema.safeParse({ port: 3.5 }).success).toBe(false);
      expect(GatewayConfigSchema.safeParse({ port: 8080 }).success).toBe(true);
    });

    it("accepts optional authToken", () => {
      const result = GatewayConfigSchema.parse({ authToken: "secret-token" });
      expect(result.authToken).toBe("secret-token");
    });

    it("rejects empty authToken", () => {
      expect(GatewayConfigSchema.safeParse({ authToken: "" }).success).toBe(false);
    });
  });

  describe("AgentConfigSchema", () => {
    it("provides default model", () => {
      const config = AgentConfigSchema.parse({});
      expect(config.defaultModel).toBe("claude-sonnet-4-20250514");
      expect(config.maxTokens).toBe(8192);
      expect(config.temperature).toBe(0.7);
    });

    it("validates temperature range", () => {
      expect(AgentConfigSchema.safeParse({ temperature: -0.1 }).success).toBe(false);
      expect(AgentConfigSchema.safeParse({ temperature: 2.1 }).success).toBe(false);
      expect(AgentConfigSchema.safeParse({ temperature: 0 }).success).toBe(true);
      expect(AgentConfigSchema.safeParse({ temperature: 2 }).success).toBe(true);
    });
  });

  describe("ChannelConfigSchema", () => {
    it("validates a channel configuration", () => {
      const config = ChannelConfigSchema.parse({
        type: "telegram",
        enabled: true,
        config: { botToken: "123:abc" },
      });
      expect(config.type).toBe("telegram");
      expect(config.enabled).toBe(true);
    });

    it("defaults enabled to true", () => {
      const config = ChannelConfigSchema.parse({ type: "discord" });
      expect(config.enabled).toBe(true);
    });

    it("rejects empty type", () => {
      expect(ChannelConfigSchema.safeParse({ type: "" }).success).toBe(false);
    });
  });

  describe("ModelConfigSchema", () => {
    it("validates a model configuration", () => {
      const config = ModelConfigSchema.parse({
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
      });
      expect(config.provider).toBe("anthropic");
      expect(config.costPer1kInput).toBe(0);
    });

    it("only accepts known providers", () => {
      expect(ModelConfigSchema.safeParse({ provider: "anthropic", model: "test" }).success).toBe(true);
      expect(ModelConfigSchema.safeParse({ provider: "openai", model: "test" }).success).toBe(true);
      expect(ModelConfigSchema.safeParse({ provider: "local", model: "test" }).success).toBe(true);
      expect(ModelConfigSchema.safeParse({ provider: "unknown", model: "test" }).success).toBe(false);
    });

    it("validates URL format for baseUrl", () => {
      expect(ModelConfigSchema.safeParse({ provider: "local", model: "test", baseUrl: "not-a-url" }).success).toBe(false);
      expect(ModelConfigSchema.safeParse({ provider: "local", model: "test", baseUrl: "http://localhost:8080" }).success).toBe(true);
    });
  });

  describe("KarnaConfigSchema", () => {
    it("parses empty config with all defaults", () => {
      const config = KarnaConfigSchema.parse({});
      expect(config.gateway.port).toBe(18789);
      expect(config.agent.defaultModel).toBe("claude-sonnet-4-20250514");
      expect(config.channels).toEqual([]);
      expect(config.models).toEqual({});
    });

    it("parses a full configuration", () => {
      const config = KarnaConfigSchema.parse({
        gateway: { port: 9000 },
        agent: { defaultModel: "claude-haiku-4-20250514" },
        channels: [{ type: "telegram", enabled: true }],
        models: {
          default: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
        },
      });
      expect(config.gateway.port).toBe(9000);
      expect(config.channels).toHaveLength(1);
    });
  });
});
