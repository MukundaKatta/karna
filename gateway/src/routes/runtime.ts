import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { WorkflowEngine } from "@karna/agent/workflows/engine.js";
import type { AccessPolicyManager } from "../access/policies.js";
import type { KarnaConfig, ModelConfig } from "../config/schema.js";
import { getEffectiveDefaultModel, getEffectiveDefaultProvider } from "../catalog/default-agents.js";
import type { ConnectedClient } from "../protocol/handler.js";
import type { SessionManager } from "../session/manager.js";

interface RuntimeModelSummary {
  id: string;
  provider: string;
  model: string;
  hasApiKey: boolean;
  baseUrl: string | null;
  maxTokens: number | null;
}

export function registerRuntimeRoutes(
  app: FastifyInstance,
  services: {
    config: KarnaConfig;
    configPath: string;
    sessionManager: SessionManager;
    connectedClients: Map<string, ConnectedClient>;
    accessPolicies: AccessPolicyManager;
    workflowEngine: WorkflowEngine;
  },
): void {
  app.get("/api/runtime", async () => {
    const {
      config,
      configPath,
      sessionManager,
      connectedClients,
      accessPolicies,
      workflowEngine,
    } = services;

    const sessions = sessionManager.listAllSessions();
    const policySnapshots = accessPolicies.listPolicySnapshots();

    const channelAccessById = new Map(
      policySnapshots.map((policy) => [
        policy.channelId,
        {
          dmMode: policy.dmMode,
          groupActivation: policy.groupActivation,
          allowlistCount: policy.allowlist.length,
          blocklistCount: policy.blocklist.length,
          pairedUserCount: policy.pairedUsers.length,
          pendingPairingCount: policy.pendingPairings.length,
          agentMentionNames: policy.agentMentionNames,
        },
      ]),
    );

    const activeSessionsByChannel = sessions.reduce<Record<string, number>>((acc, session) => {
      acc[session.channelType] = (acc[session.channelType] ?? 0) + 1;
      return acc;
    }, {});

    const liveConnectionsByChannel: Record<string, number> = {};
    for (const client of connectedClients.values()) {
      const channelTypes = new Set<string>();
      for (const sessionId of client.sessionIds) {
        const session = sessionManager.getSession(sessionId);
        if (session) {
          channelTypes.add(session.channelType);
        }
      }

      for (const channelType of channelTypes) {
        liveConnectionsByChannel[channelType] =
          (liveConnectionsByChannel[channelType] ?? 0) + 1;
      }
    }

    const trackedChannelTypes = new Set<string>(config.channels.map((channel) => channel.type));
    for (const channelType of Object.keys(activeSessionsByChannel)) {
      trackedChannelTypes.add(channelType);
    }
    for (const channelType of Object.keys(liveConnectionsByChannel)) {
      trackedChannelTypes.add(channelType);
    }
    for (const policy of policySnapshots) {
      trackedChannelTypes.add(policy.channelId);
    }

    const channels = Array.from(trackedChannelTypes)
      .sort()
      .map((channelType) => {
        const channelConfig = config.channels.find((channel) => channel.type === channelType);

        return {
          type: channelType,
          configured: Boolean(channelConfig),
          enabled: channelConfig?.enabled ?? false,
          settingsKeys: Object.keys(channelConfig?.config ?? {}).sort(),
          activeSessions: activeSessionsByChannel[channelType] ?? 0,
          liveConnections: liveConnectionsByChannel[channelType] ?? 0,
          access: channelAccessById.get(channelType) ?? null,
        };
      });

    const workflows = workflowEngine.list();
    const workflowRuns = workflowEngine.getRuns(undefined, 500);
    const effectiveDefaultModel = resolveEffectiveDefaultModel(config);
    const effectiveDefaultProvider = resolveEffectiveDefaultProvider(config, effectiveDefaultModel);
    const runtimeModels = buildRuntimeModels(
      config,
      effectiveDefaultProvider,
      effectiveDefaultModel,
    );

    return {
      runtime: {
        instance: {
          name: "karna-gateway",
          env: process.env["NODE_ENV"] ?? "development",
          version: "0.1.0",
          configPath,
          configFileExists: existsSync(configPath),
        },
        gateway: {
          host: process.env["GATEWAY_HOST"] ?? config.gateway.host,
          port: resolveGatewayPort(config),
          maxConnections: config.gateway.maxConnections,
          heartbeatIntervalMs: config.gateway.heartbeatIntervalMs,
          sessionTimeoutMs: config.gateway.sessionTimeoutMs,
          corsOrigin: config.gateway.corsOrigin,
          authEnabled: Boolean(config.gateway.authToken || process.env["GATEWAY_AUTH_TOKEN"]),
        },
        agent: {
          defaultModel: effectiveDefaultModel,
          maxTokens: config.agent.maxTokens,
          temperature: config.agent.temperature,
          systemPromptConfigured: Boolean(config.agent.systemPrompt),
          workspacePath: config.agent.workspacePath ?? null,
          providerCounts: summarizeProviderCounts(runtimeModels),
        },
        memory: {
          enabled: config.memory.enabled,
          backend: config.memory.backend,
          maxEntriesPerSession: config.memory.maxEntriesPerSession,
          defaultTtlMs: config.memory.defaultTtlMs ?? null,
          embedding: {
            enabled: config.memory.embedding.enabled,
            model: config.memory.embedding.model,
            dimensions: config.memory.embedding.dimensions,
          },
          connectionConfigured: resolveMemoryConnectionConfigured(config),
        },
        models: runtimeModels,
        environment: {
          configOverride: Boolean(process.env["KARNA_CONFIG"]),
          gatewayHostOverride: Boolean(process.env["GATEWAY_HOST"]),
          gatewayPortOverride: Boolean(process.env["GATEWAY_PORT"]),
          logLevelOverride: Boolean(process.env["LOG_LEVEL"]),
          gatewayAuthTokenConfigured: Boolean(process.env["GATEWAY_AUTH_TOKEN"]),
          supabaseUrlConfigured: Boolean(process.env["SUPABASE_URL"]),
          defaultProviderOverride: Boolean(process.env["KARNA_DEFAULT_PROVIDER"]),
          defaultModelOverride: Boolean(process.env["KARNA_DEFAULT_MODEL"]),
          anthropicApiKeyConfigured: Boolean(process.env["ANTHROPIC_API_KEY"]),
          openaiApiKeyConfigured: Boolean(process.env["OPENAI_API_KEY"]),
          openaiBaseUrlConfigured: Boolean(process.env["OPENAI_BASE_URL"]),
        },
        channels,
        access: {
          channelPolicies: policySnapshots.length,
          allowlistedUsers: policySnapshots.reduce(
            (sum, policy) => sum + policy.allowlist.length,
            0,
          ),
          blocklistedUsers: policySnapshots.reduce(
            (sum, policy) => sum + policy.blocklist.length,
            0,
          ),
          pairedUsers: policySnapshots.reduce(
            (sum, policy) => sum + policy.pairedUsers.length,
            0,
          ),
          pendingPairings: policySnapshots.reduce(
            (sum, policy) => sum + policy.pendingPairings.length,
            0,
          ),
        },
        workflows: {
          total: workflows.length,
          enabled: workflows.filter((workflow) => workflow.enabled).length,
          disabled: workflows.filter((workflow) => !workflow.enabled).length,
          recentRuns: workflowRuns.length,
          lastRunAt: workflowRuns[0]?.startedAt ?? null,
        },
      },
    };
  });
}

function resolveGatewayPort(config: KarnaConfig): number {
  const envPort = Number(process.env["GATEWAY_PORT"]);
  return Number.isFinite(envPort) && envPort > 0 ? envPort : config.gateway.port;
}

function resolveEffectiveDefaultModel(config: KarnaConfig): string {
  return process.env["KARNA_DEFAULT_MODEL"] ?? config.agent.defaultModel ?? getEffectiveDefaultModel();
}

function resolveEffectiveDefaultProvider(config: KarnaConfig, effectiveDefaultModel: string): string {
  const providerOverride = process.env["KARNA_DEFAULT_PROVIDER"];
  if (providerOverride === "anthropic" || providerOverride === "openai" || providerOverride === "local") {
    return providerOverride;
  }

  const configuredModel = Object.values(config.models).find(
    (model) => model.model === effectiveDefaultModel,
  );
  return configuredModel?.provider
    ?? inferProviderFromModel(effectiveDefaultModel)
    ?? getEffectiveDefaultProvider();
}

function inferProviderFromModel(model: string): "anthropic" | "openai" | "local" {
  if (model.startsWith("claude") || model.startsWith("anthropic")) {
    return "anthropic";
  }
  if (
    model.startsWith("gpt")
    || model.startsWith("o1")
    || model.startsWith("o3")
    || model.startsWith("gemini")
    || model.startsWith("openrouter/")
  ) {
    return "openai";
  }
  return "local";
}

function buildRuntimeModels(
  config: KarnaConfig,
  effectiveDefaultProvider: string,
  effectiveDefaultModel: string,
): RuntimeModelSummary[] {
  const configuredModels = Object.entries(config.models)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, model]) => toRuntimeModel(id, model));

  const envDefaultModel = buildEnvironmentDefaultModel(
    configuredModels,
    effectiveDefaultProvider,
    effectiveDefaultModel,
  );

  return [...configuredModels, ...(envDefaultModel ? [envDefaultModel] : [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function buildEnvironmentDefaultModel(
  configuredModels: RuntimeModelSummary[],
  effectiveDefaultProvider: string,
  effectiveDefaultModel: string,
): RuntimeModelSummary | null {
  if (!effectiveDefaultModel || !providerHasEnvironmentCredentials(effectiveDefaultProvider)) {
    return null;
  }

  const baseUrl =
    effectiveDefaultProvider === "openai" ? process.env["OPENAI_BASE_URL"] ?? null : null;
  const duplicate = configuredModels.some(
    (model) =>
      model.provider === effectiveDefaultProvider
      && model.model === effectiveDefaultModel
      && model.baseUrl === baseUrl,
  );
  if (duplicate) {
    return null;
  }

  return {
    id: "environment-default",
    provider: effectiveDefaultProvider,
    model: effectiveDefaultModel,
    hasApiKey: true,
    baseUrl,
    maxTokens: null,
  };
}

function toRuntimeModel(id: string, model: ModelConfig): RuntimeModelSummary {
  return {
    id,
    provider: model.provider,
    model: model.model,
    hasApiKey: Boolean(model.apiKey || resolveEnvApiKey(model.provider)),
    baseUrl:
      model.baseUrl
      ?? (model.provider === "openai" ? process.env["OPENAI_BASE_URL"] ?? null : null),
    maxTokens: model.maxTokens ?? null,
  };
}

function resolveEnvApiKey(provider: string): string | undefined {
  switch (provider) {
    case "anthropic":
      return process.env["ANTHROPIC_API_KEY"];
    case "openai":
      return process.env["OPENAI_API_KEY"];
    default:
      return undefined;
  }
}

function providerHasEnvironmentCredentials(provider: string): boolean {
  return Boolean(resolveEnvApiKey(provider));
}

function resolveMemoryConnectionConfigured(config: KarnaConfig): boolean {
  switch (config.memory.backend) {
    case "sqlite":
      return true;
    case "postgres":
    case "redis":
      return Boolean(config.memory.connectionString);
    case "supabase":
      return Boolean(config.memory.connectionString || process.env["SUPABASE_URL"]);
    default:
      return false;
  }
}

function summarizeProviderCounts(models: RuntimeModelSummary[]) {
  const summary = {
    anthropic: 0,
    openai: 0,
    local: 0,
  };

  for (const model of models) {
    if (model.provider in summary) {
      summary[model.provider as keyof typeof summary] += 1;
    }
  }

  return {
    anthropic: {
      configured: summary.anthropic > 0 || Boolean(process.env["ANTHROPIC_API_KEY"]),
      modelCount: summary.anthropic,
    },
    openai: {
      configured: summary.openai > 0 || Boolean(process.env["OPENAI_API_KEY"]),
      modelCount: summary.openai,
    },
    local: {
      configured: summary.local > 0,
      modelCount: summary.local,
    },
  };
}
