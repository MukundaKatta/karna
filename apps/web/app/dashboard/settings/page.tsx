"use client";

import { useState } from "react";
import { Save, Eye, EyeOff, Download, Upload, RefreshCw, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/Badge";

interface SettingsState {
  gateway: {
    url: string;
    wsPath: string;
    port: number;
  };
  apiKeys: {
    anthropic: string;
    openai: string;
  };
  channels: {
    web: boolean;
    cli: boolean;
    slack: boolean;
    discord: boolean;
    whatsapp: boolean;
  };
  model: {
    default: string;
    fallback: string;
    maxTokens: number;
    temperature: number;
  };
  memory: {
    enabled: boolean;
    backend: string;
    maxEntries: number;
    embeddingEnabled: boolean;
  };
  heartbeat: {
    intervalMs: number;
    timeoutMs: number;
  };
}

const defaultSettings: SettingsState = {
  gateway: {
    url: "http://localhost:4000",
    wsPath: "/ws",
    port: 4000,
  },
  apiKeys: {
    anthropic: "sk-ant-api03-xxxx...xxxx",
    openai: "",
  },
  channels: {
    web: true,
    cli: true,
    slack: false,
    discord: false,
    whatsapp: false,
  },
  model: {
    default: "claude-sonnet-4-20250514",
    fallback: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    temperature: 0.7,
  },
  memory: {
    enabled: true,
    backend: "sqlite",
    maxEntries: 1000,
    embeddingEnabled: false,
  },
  heartbeat: {
    intervalMs: 30000,
    timeoutMs: 10000,
  },
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const maskApiKey = (key: string): string => {
    if (!key) return "";
    if (key.length <= 12) return "****";
    return key.slice(0, 8) + "..." + key.slice(-4);
  };

  const updateNested = <T extends keyof SettingsState>(
    section: T,
    key: string,
    value: unknown,
  ) => {
    setSettings((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  };

  const inputClass =
    "w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-accent-500";
  const labelClass = "block text-sm font-medium text-dark-300 mb-1";

  return (
    <div className="p-4 sm:p-6 space-y-6 sm:space-y-8 max-w-4xl overflow-y-auto h-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pl-10 md:pl-0">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-white">Settings</h1>
          <p className="text-xs sm:text-sm text-dark-400 mt-1">Configure your Karna gateway</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button className="flex items-center gap-2 px-3 py-2 text-sm text-dark-400 hover:text-white bg-dark-700 rounded-lg hover:bg-dark-600 transition-colors">
            <Download size={14} />
            Export
          </button>
          <button className="flex items-center gap-2 px-3 py-2 text-sm text-dark-400 hover:text-white bg-dark-700 rounded-lg hover:bg-dark-600 transition-colors">
            <Upload size={14} />
            Import
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-accent-600 text-white text-sm font-medium rounded-lg hover:bg-accent-500 transition-colors"
          >
            {saved ? <CheckCircle2 size={16} /> : <Save size={16} />}
            {saved ? "Saved!" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Gateway Connection */}
      <section className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4">
        <h2 className="text-base font-medium text-white">Gateway Connection</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Gateway URL</label>
            <input
              type="text"
              value={settings.gateway.url}
              onChange={(e) => updateNested("gateway", "url", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>WebSocket Path</label>
            <input
              type="text"
              value={settings.gateway.wsPath}
              onChange={(e) => updateNested("gateway", "wsPath", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Port</label>
            <input
              type="number"
              value={settings.gateway.port}
              onChange={(e) => updateNested("gateway", "port", parseInt(e.target.value) || 0)}
              className={inputClass}
            />
          </div>
        </div>
      </section>

      {/* API Keys */}
      <section className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4">
        <h2 className="text-base font-medium text-white">API Keys</h2>
        {(["anthropic", "openai"] as const).map((provider) => (
          <div key={provider}>
            <label className={labelClass}>{provider === "anthropic" ? "Anthropic" : "OpenAI"} API Key</label>
            <div className="relative">
              <input
                type={showApiKeys[provider] ? "text" : "password"}
                value={
                  showApiKeys[provider]
                    ? settings.apiKeys[provider]
                    : maskApiKey(settings.apiKeys[provider])
                }
                onChange={(e) => updateNested("apiKeys", provider, e.target.value)}
                className={cn(inputClass, "pr-10")}
                placeholder={`Enter ${provider} API key`}
              />
              <button
                onClick={() => setShowApiKeys((prev) => ({ ...prev, [provider]: !prev[provider] }))}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-dark-400 hover:text-white transition-colors"
              >
                {showApiKeys[provider] ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* Channel Configuration */}
      <section className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4">
        <h2 className="text-base font-medium text-white">Channels</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {Object.entries(settings.channels).map(([channel, enabled]) => (
            <div
              key={channel}
              className="flex items-center justify-between px-4 py-3 rounded-lg bg-dark-700/50 border border-dark-600"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-dark-200 capitalize">{channel}</span>
                {enabled && <Badge variant="success">Active</Badge>}
              </div>
              <button
                onClick={() =>
                  updateNested("channels", channel, !enabled)
                }
                className={cn(
                  "relative w-10 h-5 rounded-full transition-colors",
                  enabled ? "bg-accent-600" : "bg-dark-600",
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                    enabled ? "left-5.5" : "left-0.5",
                  )}
                />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Model Preferences */}
      <section className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4">
        <h2 className="text-base font-medium text-white">Model Preferences</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Default Model</label>
            <select
              value={settings.model.default}
              onChange={(e) => updateNested("model", "default", e.target.value)}
              className={inputClass}
            >
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              <option value="claude-opus-4-20250514">Claude Opus 4</option>
              <option value="gpt-4o">GPT-4o</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Fallback Model</label>
            <select
              value={settings.model.fallback}
              onChange={(e) => updateNested("model", "fallback", e.target.value)}
              className={inputClass}
            >
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
              <option value="claude-opus-4-20250514">Claude Opus 4</option>
              <option value="gpt-4o">GPT-4o</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Max Tokens</label>
            <input
              type="number"
              value={settings.model.maxTokens}
              onChange={(e) => updateNested("model", "maxTokens", parseInt(e.target.value) || 0)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Temperature ({settings.model.temperature})</label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={settings.model.temperature}
              onChange={(e) => updateNested("model", "temperature", parseFloat(e.target.value))}
              className="w-full h-2 bg-dark-600 rounded-lg appearance-none cursor-pointer accent-accent-600"
            />
          </div>
        </div>
      </section>

      {/* Memory Settings */}
      <section className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-white">Memory</h2>
          <button
            onClick={() => updateNested("memory", "enabled", !settings.memory.enabled)}
            className={cn(
              "relative w-10 h-5 rounded-full transition-colors",
              settings.memory.enabled ? "bg-accent-600" : "bg-dark-600",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                settings.memory.enabled ? "left-5.5" : "left-0.5",
              )}
            />
          </button>
        </div>
        {settings.memory.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Backend</label>
              <select
                value={settings.memory.backend}
                onChange={(e) => updateNested("memory", "backend", e.target.value)}
                className={inputClass}
              >
                <option value="sqlite">SQLite</option>
                <option value="postgres">PostgreSQL</option>
                <option value="redis">Redis</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Max Entries per Session</label>
              <input
                type="number"
                value={settings.memory.maxEntries}
                onChange={(e) => updateNested("memory", "maxEntries", parseInt(e.target.value) || 0)}
                className={inputClass}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer py-2">
                <input
                  type="checkbox"
                  checked={settings.memory.embeddingEnabled}
                  onChange={(e) => updateNested("memory", "embeddingEnabled", e.target.checked)}
                  className="w-4 h-4 rounded border-dark-600 bg-dark-700 text-accent-600 focus:ring-accent-500"
                />
                <span className="text-sm text-dark-300">Enable Embeddings</span>
              </label>
            </div>
          </div>
        )}
      </section>

      {/* Heartbeat */}
      <section className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-4">
        <h2 className="text-base font-medium text-white">Heartbeat</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Interval (ms)</label>
            <input
              type="number"
              value={settings.heartbeat.intervalMs}
              onChange={(e) => updateNested("heartbeat", "intervalMs", parseInt(e.target.value) || 0)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Timeout (ms)</label>
            <input
              type="number"
              value={settings.heartbeat.timeoutMs}
              onChange={(e) => updateNested("heartbeat", "timeoutMs", parseInt(e.target.value) || 0)}
              className={inputClass}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
