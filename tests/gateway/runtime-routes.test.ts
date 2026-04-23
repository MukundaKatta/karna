import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { KarnaConfigSchema } from "../../gateway/src/config/schema.js";
import { WorkflowEngine } from "../../agent/src/workflows/engine.js";
import { AccessPolicyManager } from "../../gateway/src/access/policies.js";
import type { ConnectedClient } from "../../gateway/src/protocol/handler.js";
import { registerRuntimeRoutes } from "../../gateway/src/routes/runtime.js";
import { SessionManager } from "../../gateway/src/session/manager.js";

describe("runtime routes", () => {
  let app: ReturnType<typeof Fastify>;
  let sessionManager: SessionManager;
  let accessPolicies: AccessPolicyManager;
  let workflowEngine: WorkflowEngine;
  let connectedClients: Map<string, ConnectedClient>;
  const originalGatewayHost = process.env["GATEWAY_HOST"];
  const originalGatewayPort = process.env["GATEWAY_PORT"];
  const originalPlatformPort = process.env["PORT"];
  const originalGatewayCorsOrigins = process.env["GATEWAY_CORS_ORIGINS"];
  const originalDefaultProvider = process.env["KARNA_DEFAULT_PROVIDER"];
  const originalDefaultModel = process.env["KARNA_DEFAULT_MODEL"];
  const originalOpenAiKey = process.env["OPENAI_API_KEY"];
  const originalOpenAiBaseUrl = process.env["OPENAI_BASE_URL"];

  beforeEach(async () => {
    app = Fastify();
    sessionManager = new SessionManager();
    accessPolicies = new AccessPolicyManager({ storagePath: false });
    workflowEngine = new WorkflowEngine();
    connectedClients = new Map();

    const config = KarnaConfigSchema.parse({
      gateway: {
        host: "127.0.0.1",
        port: 4100,
        authToken: "gateway-secret",
        maxConnections: 25,
        heartbeatIntervalMs: 20_000,
        sessionTimeoutMs: 8_000,
        cors: { origins: ["https://karna.example.com"] },
      },
      agent: {
        defaultModel: "claude-sonnet-4-20250514",
        maxTokens: 6000,
        temperature: 0.4,
        systemPrompt: "You are Karna.",
        workspacePath: "/tmp/workspace",
      },
      channels: [
        {
          type: "slack",
          enabled: true,
          config: {
            signingSecret: "configured",
            botToken: "configured",
          },
        },
      ],
      memory: {
        enabled: true,
        backend: "sqlite",
        maxEntriesPerSession: 2500,
        embedding: {
          enabled: true,
          model: "text-embedding-3-small",
          dimensions: 1536,
        },
      },
      models: {
        sonnet: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          apiKey: "anthropic-key",
          baseUrl: "https://api.anthropic.com",
        },
        gpt: {
          provider: "openai",
          model: "gpt-4o",
          apiKey: "openai-key",
        },
      },
    });

    const slackSession = sessionManager.createSession("slack-channel-1", "slack", "user-1");
    connectedClients.set("socket-1", {
      ws: {} as ConnectedClient["ws"],
      auth: null,
      sessionIds: new Set([slackSession.id]),
    });

    accessPolicies.setDmMode("slack", "pairing");
    accessPolicies.setGroupActivation("slack", "mention");
    accessPolicies.addToAllowlist("slack", "user-allow");
    accessPolicies.addToBlocklist("slack", "user-block");
    accessPolicies.issuePairingCode("slack", "user-pending");

    workflowEngine.register({
      id: "wf-1",
      name: "Inbox Triage",
      description: "Triage inbound messages",
      nodes: [],
      edges: [],
      trigger: { type: "manual", config: {} },
      enabled: true,
      createdAt: Date.now() - 5_000,
      updatedAt: Date.now() - 1_000,
    });
    workflowEngine.register({
      id: "wf-2",
      name: "Weekly Digest",
      description: "Digest",
      nodes: [],
      edges: [],
      trigger: { type: "schedule", config: { schedule: "0 9 * * MON" } },
      enabled: false,
      createdAt: Date.now() - 5_000,
      updatedAt: Date.now() - 1_000,
    });
    await workflowEngine.execute("wf-1");

    registerRuntimeRoutes(app, {
      config,
      configPath: "/tmp/karna.json",
      sessionManager,
      connectedClients,
      accessPolicies,
      workflowEngine,
    });
    await app.ready();
  });

  afterEach(async () => {
    if (originalGatewayHost === undefined) delete process.env["GATEWAY_HOST"];
    else process.env["GATEWAY_HOST"] = originalGatewayHost;
    if (originalGatewayPort === undefined) delete process.env["GATEWAY_PORT"];
    else process.env["GATEWAY_PORT"] = originalGatewayPort;
    if (originalPlatformPort === undefined) delete process.env["PORT"];
    else process.env["PORT"] = originalPlatformPort;
    if (originalGatewayCorsOrigins === undefined) delete process.env["GATEWAY_CORS_ORIGINS"];
    else process.env["GATEWAY_CORS_ORIGINS"] = originalGatewayCorsOrigins;
    if (originalDefaultProvider === undefined) delete process.env["KARNA_DEFAULT_PROVIDER"];
    else process.env["KARNA_DEFAULT_PROVIDER"] = originalDefaultProvider;
    if (originalDefaultModel === undefined) delete process.env["KARNA_DEFAULT_MODEL"];
    else process.env["KARNA_DEFAULT_MODEL"] = originalDefaultModel;
    if (originalOpenAiKey === undefined) delete process.env["OPENAI_API_KEY"];
    else process.env["OPENAI_API_KEY"] = originalOpenAiKey;
    if (originalOpenAiBaseUrl === undefined) delete process.env["OPENAI_BASE_URL"];
    else process.env["OPENAI_BASE_URL"] = originalOpenAiBaseUrl;
    await app.close();
  });

  it("returns a gateway runtime snapshot with channel, access, model, and workflow summaries", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/runtime",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json().runtime;
    expect(payload.instance).toMatchObject({
      name: "karna-gateway",
      configPath: "/tmp/karna.json",
    });
    expect(payload.gateway).toMatchObject({
      host: "127.0.0.1",
      port: 4100,
      maxConnections: 25,
      authEnabled: true,
    });
    expect(payload.agent).toMatchObject({
      defaultModel: "claude-sonnet-4-20250514",
      maxTokens: 6000,
      temperature: 0.4,
      systemPromptConfigured: true,
      workspacePath: "/tmp/workspace",
    });
    expect(payload.agent.providerCounts).toMatchObject({
      anthropic: { configured: true, modelCount: 1 },
      openai: { configured: true, modelCount: 1 },
      local: { configured: false, modelCount: 0 },
    });
    expect(payload.memory).toMatchObject({
      enabled: true,
      backend: "sqlite",
      connectionConfigured: true,
    });
    expect(payload.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "sonnet",
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          hasApiKey: true,
          baseUrl: "https://api.anthropic.com",
        }),
        expect.objectContaining({
          id: "gpt",
          provider: "openai",
          model: "gpt-4o",
          hasApiKey: true,
        }),
      ]),
    );
    expect(payload.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "slack",
          configured: true,
          enabled: true,
          activeSessions: 1,
          liveConnections: 1,
          access: expect.objectContaining({
            dmMode: "pairing",
            groupActivation: "mention",
            allowlistCount: 1,
            blocklistCount: 1,
            pendingPairingCount: 1,
          }),
        }),
      ]),
    );
    expect(payload.access).toMatchObject({
      channelPolicies: 1,
      allowlistedUsers: 1,
      blocklistedUsers: 1,
      pendingPairings: 1,
    });
    expect(payload.workflows).toMatchObject({
      total: 2,
      enabled: 1,
      disabled: 1,
      recentRuns: 1,
    });
  });

  it("prefers live environment overrides for gateway and default model reporting", async () => {
    process.env["GATEWAY_HOST"] = "127.0.0.9";
    process.env["GATEWAY_PORT"] = "4999";
    process.env["GATEWAY_CORS_ORIGINS"] = "https://app.karna.ai, https://karna-web.vercel.app";
    process.env["KARNA_DEFAULT_PROVIDER"] = "openai";
    process.env["KARNA_DEFAULT_MODEL"] = "gemini-3-flash-preview";
    process.env["OPENAI_API_KEY"] = "env-openai-key";
    process.env["OPENAI_BASE_URL"] = "https://generativelanguage.googleapis.com/v1beta/openai";

    const response = await app.inject({
      method: "GET",
      url: "/api/runtime",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json().runtime;
    expect(payload.gateway).toMatchObject({
      host: "127.0.0.9",
      port: 4999,
      corsOrigin: "https://app.karna.ai,https://karna-web.vercel.app",
    });
    expect(payload.agent).toMatchObject({
      defaultModel: "gemini-3-flash-preview",
    });
    expect(payload.agent.providerCounts.openai).toMatchObject({
      configured: true,
      modelCount: 2,
    });
    expect(payload.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "environment-default",
          provider: "openai",
          model: "gemini-3-flash-preview",
          hasApiKey: true,
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        }),
      ]),
    );
  });

  it("falls back to the platform PORT when GATEWAY_PORT is unset", async () => {
    delete process.env["GATEWAY_PORT"];
    process.env["PORT"] = "6123";

    const response = await app.inject({
      method: "GET",
      url: "/api/runtime",
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json().runtime;
    expect(payload.gateway).toMatchObject({
      port: 6123,
    });
    expect(payload.environment).toMatchObject({
      gatewayPortOverride: true,
    });
  });
});
