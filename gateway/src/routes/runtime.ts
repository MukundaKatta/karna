import { existsSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import type { WorkflowEngine } from "@karna/agent/workflows/engine.js";
import type { AccessPolicyManager } from "../access/policies.js";
import type { KarnaConfig } from "../config/schema.js";
import type { ConnectedClient } from "../protocol/handler.js";
import type { SessionManager } from "../session/manager.js";

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
          host: config.gateway.host,
          port: config.gateway.port,
          maxConnections: config.gateway.maxConnections,
          heartbeatIntervalMs: config.gateway.heartbeatIntervalMs,
          sessionTimeoutMs: config.gateway.sessionTimeoutMs,
          corsOrigin: config.gateway.corsOrigin,
          authEnabled: Boolean(config.gateway.authToken || process.env["GATEWAY_AUTH_TOKEN"]),
        },
        agent: {
          defaultModel: config.agent.defaultModel,
          maxTokens: config.agent.maxTokens,
          temperature: config.agent.temperature,
          systemPromptConfigured: Boolean(config.agent.systemPrompt),
          workspacePath: config.agent.workspacePath ?? null,
          providerCounts: summarizeProviderCounts(config),
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
        models: Object.entries(config.models)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, model]) => ({
            id,
            provider: model.provider,
            model: model.model,
            hasApiKey: Boolean(model.apiKey),
            baseUrl: model.baseUrl ?? null,
            maxTokens: model.maxTokens ?? null,
          })),
        environment: {
          configOverride: Boolean(process.env["KARNA_CONFIG"]),
          gatewayHostOverride: Boolean(process.env["GATEWAY_HOST"]),
          gatewayPortOverride: Boolean(process.env["GATEWAY_PORT"]),
          logLevelOverride: Boolean(process.env["LOG_LEVEL"]),
          gatewayAuthTokenConfigured: Boolean(process.env["GATEWAY_AUTH_TOKEN"]),
          supabaseUrlConfigured: Boolean(process.env["SUPABASE_URL"]),
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

function summarizeProviderCounts(config: KarnaConfig) {
  const summary = {
    anthropic: 0,
    openai: 0,
    local: 0,
  };

  for (const model of Object.values(config.models)) {
    summary[model.provider] += 1;
  }

  return {
    anthropic: {
      configured: summary.anthropic > 0,
      modelCount: summary.anthropic,
    },
    openai: {
      configured: summary.openai > 0,
      modelCount: summary.openai,
    },
    local: {
      configured: summary.local > 0,
      modelCount: summary.local,
    },
  };
}
