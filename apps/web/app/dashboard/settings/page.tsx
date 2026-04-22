"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Bot,
  Download,
  HardDrive,
  Power,
  RefreshCw,
  Server,
  ShieldCheck,
  Upload,
  Waves,
  Workflow,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Badge } from "@/components/Badge";
import { useVoiceSettingsStore } from "@/lib/store";

interface RuntimePayload {
  runtime: {
    instance: {
      name: string;
      env: string;
      version: string;
      configPath: string;
      configFileExists: boolean;
    };
    gateway: {
      host: string;
      port: number;
      maxConnections: number;
      heartbeatIntervalMs: number;
      sessionTimeoutMs: number;
      corsOrigin: string;
      authEnabled: boolean;
    };
    agent: {
      defaultModel: string;
      maxTokens: number;
      temperature: number;
      systemPromptConfigured: boolean;
      workspacePath: string | null;
      providerCounts: {
        anthropic: {
          configured: boolean;
          modelCount: number;
        };
        openai: {
          configured: boolean;
          modelCount: number;
        };
        local: {
          configured: boolean;
          modelCount: number;
        };
      };
    };
    memory: {
      enabled: boolean;
      backend: string;
      maxEntriesPerSession: number;
      defaultTtlMs: number | null;
      embedding: {
        enabled: boolean;
        model: string;
        dimensions: number;
      };
      connectionConfigured: boolean;
    };
    models: Array<{
      id: string;
      provider: string;
      model: string;
      hasApiKey: boolean;
      baseUrl: string | null;
      maxTokens: number | null;
    }>;
    environment: {
      configOverride: boolean;
      gatewayHostOverride: boolean;
      gatewayPortOverride: boolean;
      logLevelOverride: boolean;
      gatewayAuthTokenConfigured: boolean;
      supabaseUrlConfigured: boolean;
    };
    channels: Array<{
      type: string;
      configured: boolean;
      enabled: boolean;
      settingsKeys: string[];
      activeSessions: number;
      liveConnections: number;
      access: {
        dmMode: string;
        groupActivation: string;
        allowlistCount: number;
        blocklistCount: number;
        pairedUserCount: number;
        pendingPairingCount: number;
        agentMentionNames: string[];
      } | null;
    }>;
    access: {
      channelPolicies: number;
      allowlistedUsers: number;
      blocklistedUsers: number;
      pairedUsers: number;
      pendingPairings: number;
    };
    workflows: {
      total: number;
      enabled: number;
      disabled: number;
      recentRuns: number;
      lastRunAt: number | null;
    };
  };
}

interface GatewayHealthResponse {
  status: "healthy" | "degraded" | "unhealthy" | "unreachable";
  uptimeHuman?: string;
  connections?: number;
  sessions?: number;
  database?: "connected" | "disconnected" | "unknown";
  memoryUsage?: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
  };
  error?: string;
}

type Notice = {
  tone: "success" | "warning";
  message: string;
} | null;

export default function SettingsPage() {
  const [runtime, setRuntime] = useState<RuntimePayload["runtime"] | null>(null);
  const [health, setHealth] = useState<GatewayHealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const hydrated = useVoiceSettingsStore((state) => state.hydrated);
  const hydrateVoiceSettings = useVoiceSettingsStore((state) => state.hydrateVoiceSettings);
  const liveVoiceEnabled = useVoiceSettingsStore((state) => state.liveVoiceEnabled);
  const setLiveVoiceEnabled = useVoiceSettingsStore((state) => state.setLiveVoiceEnabled);
  const liveVoicePeerChannelId = useVoiceSettingsStore((state) => state.liveVoicePeerChannelId);
  const setLiveVoicePeerChannelId = useVoiceSettingsStore(
    (state) => state.setLiveVoicePeerChannelId,
  );

  useEffect(() => {
    hydrateVoiceSettings();
  }, [hydrateVoiceSettings]);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData(refresh = false) {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setError(null);

    try {
      const [runtimeRes, healthRes] = await Promise.all([
        fetch("/api/runtime", { cache: "no-store" }),
        fetch("/api/gateway", { cache: "no-store" }),
      ]);

      if (!runtimeRes.ok) {
        throw new Error(`Runtime request failed with ${runtimeRes.status}`);
      }

      const runtimePayload = (await runtimeRes.json()) as RuntimePayload;
      const healthPayload = healthRes.ok
        ? ((await healthRes.json()) as GatewayHealthResponse)
        : ({
            status: "unreachable",
            error: `Gateway returned ${healthRes.status}`,
          } satisfies GatewayHealthResponse);

      setRuntime(runtimePayload.runtime);
      setHealth(healthPayload);
    } catch (fetchError) {
      setRuntime(null);
      setHealth(null);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to load runtime settings",
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  async function handleRestartRuntime() {
    setIsRestarting(true);
    setNotice(null);

    try {
      const response = await fetch("/api/restart", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requestedBy: "dashboard-settings",
          reason: "operator initiated runtime restart",
        }),
      });

      if (!response.ok) {
        throw new Error(`Restart request failed with ${response.status}`);
      }

      setNotice({
        tone: "success",
        message: "Runtime restart requested. Refreshing live status...",
      });
      await loadData(true);
    } catch (restartError) {
      setNotice({
        tone: "warning",
        message:
          restartError instanceof Error
            ? restartError.message
            : "Failed to restart runtime",
      });
    } finally {
      setIsRestarting(false);
    }
  }

  function handleExportSnapshot() {
    const payload = {
      exportedAt: new Date().toISOString(),
      runtime,
      health,
      localPreferences: {
        liveVoiceEnabled,
        liveVoicePeerChannelId,
      },
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `karna-settings-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);

    setNotice({
      tone: "success",
      message: "Exported the live runtime snapshot and local voice preferences.",
    });
  }

  async function handleImportVoiceSettings(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const imported = normalizeImportedVoiceSettings(parsed);

      if (!imported) {
        throw new Error("No local voice settings were found in that file.");
      }

      setLiveVoiceEnabled(imported.liveVoiceEnabled);
      setLiveVoicePeerChannelId(imported.liveVoicePeerChannelId);
      setNotice({
        tone: "success",
        message: "Imported local voice settings from the selected snapshot.",
      });
    } catch (importError) {
      setNotice({
        tone: "warning",
        message:
          importError instanceof Error
            ? importError.message
            : "Failed to import voice settings",
      });
    } finally {
      event.target.value = "";
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-dark-400">
        Loading runtime settings...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 sm:space-y-8 max-w-6xl overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      {notice && (
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-sm",
            notice.tone === "success"
              ? "border border-green-500/30 bg-green-500/10 text-green-300"
              : "border border-yellow-500/30 bg-yellow-500/10 text-yellow-300",
          )}
        >
          {notice.message}
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between pl-10 md:pl-0">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-white">Settings</h1>
          <p className="text-xs sm:text-sm text-dark-400 mt-1">
            Live runtime configuration, health, and operator controls
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => void loadData(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-dark-200 bg-dark-700 rounded-lg hover:bg-dark-600 transition-colors"
          >
            <RefreshCw size={14} className={cn(isRefreshing && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={handleExportSnapshot}
            className="flex items-center gap-2 px-3 py-2 text-sm text-dark-200 bg-dark-700 rounded-lg hover:bg-dark-600 transition-colors"
          >
            <Download size={14} />
            Export Snapshot
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            className="flex items-center gap-2 px-3 py-2 text-sm text-dark-200 bg-dark-700 rounded-lg hover:bg-dark-600 transition-colors"
          >
            <Upload size={14} />
            Import Voice Preset
          </button>
          <button
            onClick={() => void handleRestartRuntime()}
            disabled={isRestarting}
            className="flex items-center gap-2 px-4 py-2 bg-accent-600 text-white text-sm font-medium rounded-lg hover:bg-accent-500 transition-colors disabled:opacity-60"
          >
            {isRestarting ? <RefreshCw size={16} className="animate-spin" /> : <Power size={16} />}
            {isRestarting ? "Restarting..." : "Restart Runtime"}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => void handleImportVoiceSettings(event)}
          />
        </div>
      </div>

      {runtime && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <MetricCard
              icon={<Server size={18} />}
              title="Gateway"
              value={health?.status ?? "unknown"}
              subtitle={displayGatewayUrl(runtime.gateway.host, runtime.gateway.port)}
              badge={statusBadge(health?.status)}
            />
            <MetricCard
              icon={<Workflow size={18} />}
              title="Workflows"
              value={`${runtime.workflows.enabled}/${runtime.workflows.total}`}
              subtitle={
                runtime.workflows.lastRunAt
                  ? `last run ${formatRelativeTime(runtime.workflows.lastRunAt)}`
                  : "no workflow runs yet"
              }
            />
            <MetricCard
              icon={<ShieldCheck size={18} />}
              title="Access Policies"
              value={runtime.access.channelPolicies}
              subtitle={`${runtime.access.pendingPairings} pending pairings`}
            />
            <MetricCard
              icon={<HardDrive size={18} />}
              title="Memory"
              value={runtime.memory.backend}
              subtitle={
                runtime.memory.connectionConfigured
                  ? "backend connected"
                  : "connection not configured"
              }
              badge={
                <Badge variant={runtime.memory.connectionConfigured ? "success" : "warning"}>
                  {runtime.memory.connectionConfigured ? "ready" : "action needed"}
                </Badge>
              }
            />
          </div>

          <section className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-medium text-white">Gateway Runtime</h2>
                <p className="text-sm text-dark-400 mt-1">
                  Safe live snapshot of the running gateway process
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={healthVariant(health?.status)}>
                  {health?.status ?? "unknown"}
                </Badge>
                <Badge variant={runtime.instance.configFileExists ? "success" : "warning"}>
                  {runtime.instance.configFileExists ? "config found" : "defaults only"}
                </Badge>
                <Badge variant={runtime.gateway.authEnabled ? "info" : "default"}>
                  {runtime.gateway.authEnabled ? "auth enabled" : "auth off"}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <KeyValueList
                title="Instance"
                rows={[
                  { label: "Name", value: runtime.instance.name },
                  { label: "Environment", value: runtime.instance.env },
                  { label: "Version", value: runtime.instance.version },
                  { label: "Config Path", value: runtime.instance.configPath, mono: true },
                  { label: "Gateway URL", value: displayGatewayUrl(runtime.gateway.host, runtime.gateway.port), mono: true },
                  { label: "CORS Origin", value: runtime.gateway.corsOrigin || "not set" },
                ]}
              />
              <KeyValueList
                title="Health"
                rows={[
                  { label: "Uptime", value: health?.uptimeHuman ?? "unknown" },
                  { label: "Connections", value: String(health?.connections ?? 0) },
                  { label: "Sessions", value: String(health?.sessions ?? 0) },
                  { label: "Database", value: health?.database ?? "unknown" },
                  { label: "Max Connections", value: String(runtime.gateway.maxConnections) },
                  {
                    label: "Heartbeat / Timeout",
                    value: `${runtime.gateway.heartbeatIntervalMs}ms / ${runtime.gateway.sessionTimeoutMs}ms`,
                  },
                ]}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {renderEnvBadge("config override", runtime.environment.configOverride)}
              {renderEnvBadge("host override", runtime.environment.gatewayHostOverride)}
              {renderEnvBadge("port override", runtime.environment.gatewayPortOverride)}
              {renderEnvBadge("log level override", runtime.environment.logLevelOverride)}
              {renderEnvBadge(
                "gateway auth token env",
                runtime.environment.gatewayAuthTokenConfigured,
              )}
              {renderEnvBadge("supabase env", runtime.environment.supabaseUrlConfigured)}
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <section className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-medium text-white">Agent Defaults</h2>
                  <p className="text-sm text-dark-400 mt-1">
                    Runtime conversation defaults and provider coverage
                  </p>
                </div>
                <Bot size={18} className="text-dark-400" />
              </div>

              <KeyValueList
                rows={[
                  { label: "Default Model", value: runtime.agent.defaultModel },
                  { label: "Max Tokens", value: String(runtime.agent.maxTokens) },
                  { label: "Temperature", value: runtime.agent.temperature.toFixed(1) },
                  {
                    label: "System Prompt",
                    value: runtime.agent.systemPromptConfigured ? "configured" : "default only",
                  },
                  {
                    label: "Workspace Path",
                    value: runtime.agent.workspacePath ?? "not configured",
                    mono: Boolean(runtime.agent.workspacePath),
                  },
                ]}
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ProviderCountCard
                  name="Anthropic"
                  configured={runtime.agent.providerCounts.anthropic.configured}
                  modelCount={runtime.agent.providerCounts.anthropic.modelCount}
                />
                <ProviderCountCard
                  name="OpenAI"
                  configured={runtime.agent.providerCounts.openai.configured}
                  modelCount={runtime.agent.providerCounts.openai.modelCount}
                />
                <ProviderCountCard
                  name="Local"
                  configured={runtime.agent.providerCounts.local.configured}
                  modelCount={runtime.agent.providerCounts.local.modelCount}
                />
              </div>
            </section>

            <section className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-medium text-white">Memory and Models</h2>
                  <p className="text-sm text-dark-400 mt-1">
                    Persistence mode plus the configured model registry
                  </p>
                </div>
                <HardDrive size={18} className="text-dark-400" />
              </div>

              <KeyValueList
                title="Memory"
                rows={[
                  { label: "Backend", value: runtime.memory.backend },
                  { label: "Enabled", value: booleanLabel(runtime.memory.enabled) },
                  { label: "Max Entries / Session", value: String(runtime.memory.maxEntriesPerSession) },
                  {
                    label: "Default TTL",
                    value: runtime.memory.defaultTtlMs ? `${runtime.memory.defaultTtlMs}ms` : "not set",
                  },
                  {
                    label: "Embeddings",
                    value: runtime.memory.embedding.enabled
                      ? `${runtime.memory.embedding.model} (${runtime.memory.embedding.dimensions})`
                      : "disabled",
                  },
                ]}
              />

              <div className="space-y-2">
                <h3 className="text-sm font-medium text-white">Configured Models</h3>
                {runtime.models.length > 0 ? (
                  runtime.models.map((model) => (
                    <div
                      key={model.id}
                      className="rounded-lg border border-dark-700 bg-dark-900/40 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">{model.id}</p>
                          <p className="text-xs text-dark-400">
                            {model.provider} • {model.model}
                          </p>
                        </div>
                        <Badge variant={model.hasApiKey ? "success" : "warning"}>
                          {model.hasApiKey ? "key set" : "no key"}
                        </Badge>
                      </div>
                      <p className="mt-2 text-xs text-dark-500">
                        {model.baseUrl ? `base URL: ${model.baseUrl}` : "default provider URL"}
                        {model.maxTokens ? ` • max tokens ${model.maxTokens}` : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dark-700 bg-dark-900/40 px-4 py-3 text-sm text-dark-400">
                    No model overrides are configured yet.
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-medium text-white">Channels</h2>
                <p className="text-sm text-dark-400 mt-1">
                  Configured channels, live activity, and access posture
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="accent">{runtime.channels.length} channels tracked</Badge>
                <Badge variant="info">{runtime.access.pairedUsers} paired users</Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {runtime.channels.map((channel) => (
                <div
                  key={channel.type}
                  className="rounded-xl border border-dark-700 bg-dark-900/40 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">
                        {humanizeKey(channel.type)}
                      </h3>
                      <p className="text-xs text-dark-500">{channel.type}</p>
                    </div>
                    <Badge
                      variant={
                        channel.activeSessions > 0
                          ? "success"
                          : channel.enabled
                            ? "info"
                            : "default"
                      }
                    >
                      {channel.activeSessions > 0 ? "active" : channel.enabled ? "enabled" : "off"}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <MiniStat label="Configured" value={booleanLabel(channel.configured)} />
                    <MiniStat label="Sessions" value={String(channel.activeSessions)} />
                    <MiniStat label="Live Clients" value={String(channel.liveConnections)} />
                    <MiniStat
                      label="Settings"
                      value={
                        channel.settingsKeys.length > 0
                          ? `${channel.settingsKeys.length} keys`
                          : "none"
                      }
                    />
                  </div>

                  {channel.access ? (
                    <div className="rounded-lg border border-dark-700 bg-dark-800/80 px-3 py-3 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="info">DM: {channel.access.dmMode}</Badge>
                        <Badge variant="accent">Group: {channel.access.groupActivation}</Badge>
                      </div>
                      <p className="text-xs text-dark-400">
                        allow {channel.access.allowlistCount} • block {channel.access.blocklistCount} • paired {channel.access.pairedUserCount} • pending {channel.access.pendingPairingCount}
                      </p>
                      {channel.access.agentMentionNames.length > 0 && (
                        <p className="text-xs text-dark-500">
                          mentions: {channel.access.agentMentionNames.join(", ")}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dark-700 bg-dark-800/60 px-3 py-3 text-xs text-dark-500">
                      No explicit access policy stored yet.
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium text-white">Live Voice Beta</h2>
            <p className="text-sm text-dark-400 mt-1">
              These preferences are browser-local and persist immediately on this machine.
            </p>
          </div>
          <Waves size={18} className="text-dark-400" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-4">
          <div className="rounded-lg border border-dark-700 bg-dark-900/40 px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-dark-200">Live Voice</span>
              <button
                onClick={() => setLiveVoiceEnabled(!liveVoiceEnabled)}
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors",
                  liveVoiceEnabled ? "bg-accent-600" : "bg-dark-600",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                    liveVoiceEnabled ? "left-5.5" : "left-0.5",
                  )}
                />
              </button>
            </div>
            <Badge variant={liveVoiceEnabled ? "success" : "default"}>
              {liveVoiceEnabled ? "enabled" : "disabled"}
            </Badge>
            <p className="text-xs text-dark-500">
              {hydrated ? "Loaded from local browser storage." : "Hydrating local preferences..."}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-300 mb-1">
              Peer Channel ID
            </label>
            <input
              type="text"
              value={hydrated ? liveVoicePeerChannelId : ""}
              onChange={(event) => setLiveVoicePeerChannelId(event.target.value)}
              className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-accent-500"
              placeholder="mobile-voice-peer"
            />
            <p className="text-xs text-dark-500 mt-2">
              Use this to point the web voice overlay at a paired mobile or browser peer without rebuilding the app.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  title,
  value,
  subtitle,
  badge,
}: {
  icon: JSX.Element;
  title: string;
  value: string | number;
  subtitle: string;
  badge?: JSX.Element;
}) {
  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-dark-400">{title}</p>
          <p className="text-2xl font-semibold text-white">{value}</p>
          <p className="text-xs text-dark-500">{subtitle}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-dark-700 text-dark-300">
          {icon}
        </div>
      </div>
      {badge && <div className="mt-3">{badge}</div>}
    </div>
  );
}

function ProviderCountCard({
  name,
  configured,
  modelCount,
}: {
  name: string;
  configured: boolean;
  modelCount: number;
}) {
  return (
    <div className="rounded-lg border border-dark-700 bg-dark-900/40 px-4 py-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">{name}</h3>
        <Badge variant={configured ? "success" : "warning"}>
          {configured ? "ready" : "missing"}
        </Badge>
      </div>
      <p className="text-xs text-dark-400">{modelCount} configured models</p>
    </div>
  );
}

function KeyValueList({
  title,
  rows,
}: {
  title?: string;
  rows: Array<{ label: string; value: string; mono?: boolean }>;
}) {
  return (
    <div className="space-y-3">
      {title && <h3 className="text-sm font-medium text-white">{title}</h3>}
      <div className="rounded-lg border border-dark-700 bg-dark-900/30 divide-y divide-dark-700/60">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-start justify-between gap-4 px-4 py-3"
          >
            <span className="text-sm text-dark-400">{row.label}</span>
            <span
              className={cn(
                "text-sm text-dark-200 text-right",
                row.mono && "font-mono text-xs",
              )}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-dark-800/80 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-dark-500">{label}</p>
      <p className="mt-1 text-sm text-dark-200">{value}</p>
    </div>
  );
}

function booleanLabel(value: boolean): string {
  return value ? "yes" : "no";
}

function humanizeKey(value: string): string {
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function displayGatewayUrl(host: string, port: number): string {
  const safeHost = host === "0.0.0.0" ? "localhost" : host;
  return `http://${safeHost}:${port}`;
}

function healthVariant(status: GatewayHealthResponse["status"] | undefined) {
  switch (status) {
    case "healthy":
      return "success";
    case "degraded":
      return "warning";
    case "unhealthy":
    case "unreachable":
      return "danger";
    default:
      return "default";
  }
}

function statusBadge(status: GatewayHealthResponse["status"] | undefined) {
  return <Badge variant={healthVariant(status)}>{status ?? "unknown"}</Badge>;
}

function renderEnvBadge(label: string, enabled: boolean) {
  return (
    <Badge key={label} variant={enabled ? "info" : "default"}>
      {label}: {enabled ? "on" : "off"}
    </Badge>
  );
}

function normalizeImportedVoiceSettings(payload: Record<string, unknown>) {
  const source =
    (isRecord(payload.localPreferences) && payload.localPreferences) ||
    (isRecord(payload.voice) && payload.voice) ||
    payload;

  const liveVoiceEnabled =
    typeof source.liveVoiceEnabled === "boolean"
      ? source.liveVoiceEnabled
      : typeof source.enabled === "boolean"
        ? source.enabled
        : null;

  const liveVoicePeerChannelId =
    typeof source.liveVoicePeerChannelId === "string"
      ? source.liveVoicePeerChannelId
      : typeof source.peerChannelId === "string"
        ? source.peerChannelId
        : null;

  if (liveVoiceEnabled === null && liveVoicePeerChannelId === null) {
    return null;
  }

  return {
    liveVoiceEnabled: liveVoiceEnabled ?? false,
    liveVoicePeerChannelId: liveVoicePeerChannelId ?? "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
