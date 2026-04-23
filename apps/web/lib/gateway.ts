/** Gateway API client */

import { getBrowserRuntimeConfig } from "./browser-runtime-config";
import { resolvePublicGatewayUrl } from "./runtime-config";

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

class GatewayError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, signal } = options;
  let gateway = resolvePublicGatewayUrl();
  if (!gateway.url && typeof window !== "undefined") {
    const runtimeConfig = await getBrowserRuntimeConfig();
    gateway = {
      url: runtimeConfig.gatewayUrl,
      error: runtimeConfig.error,
    };
  }

  if (!gateway.url) {
    throw new GatewayError(503, gateway.error ?? "Gateway URL is not configured");
  }

  const url = `${gateway.url}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new GatewayError(res.status, text);
  }

  const contentType = res.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return res.json() as Promise<T>;
  }

  return res.text() as unknown as T;
}

/** Health check */
export async function getHealth(): Promise<{ status: string; uptime: number }> {
  return request("/health");
}

/** List sessions */
export async function listSessions(params?: {
  channel?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  sessions: Array<{
    id: string;
    channelType: string;
    channelId: string;
    status: string;
    createdAt: number;
    updatedAt: number;
    stats?: {
      messageCount: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCostUsd: number;
    };
  }>;
  total: number;
}> {
  const searchParams = new URLSearchParams();
  if (params?.channel) searchParams.set("channel", params.channel);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.offset) searchParams.set("offset", params.offset.toString());
  const qs = searchParams.toString();
  return request(`/api/sessions${qs ? `?${qs}` : ""}`);
}

/** Get session detail */
export async function getSession(sessionId: string): Promise<{
  id: string;
  channelType: string;
  channelId: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  stats?: {
    messageCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
    metadata?: {
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      toolCallId?: string;
      toolName?: string;
      finishReason?: string;
      latencyMs?: number;
    };
  }>;
}> {
  return request(`/api/sessions/${sessionId}`);
}

/** Search memory */
export async function searchMemory(params: {
  query?: string;
  category?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  entries: Array<{
    id: string;
    content: string;
    summary?: string;
    source: string;
    priority: string;
    tags: string[];
    category?: string;
    createdAt: number;
    score: number;
  }>;
  total: number;
  hasMore: boolean;
}> {
  return request("/api/memory/search", { method: "POST", body: params });
}

/** Delete memory entry */
export async function deleteMemory(id: string): Promise<void> {
  return request(`/api/memory/${id}`, { method: "DELETE" });
}

/** Get analytics */
export async function getAnalytics(params?: {
  from?: number;
  to?: number;
  granularity?: "hour" | "day" | "week";
}): Promise<{
  summary: {
    totalMessages: number;
    totalSessions: number;
    totalTokens: number;
    totalCost: number;
  };
  timeSeries: Array<{
    timestamp: number;
    messages: number;
    tokens: number;
    cost: number;
  }>;
  topTools: Array<{ name: string; count: number }>;
  channelBreakdown: Array<{ channel: string; count: number }>;
  modelUsage: Array<{ model: string; tokens: number; cost: number }>;
}> {
  const searchParams = new URLSearchParams();
  if (params?.from) searchParams.set("from", params.from.toString());
  if (params?.to) searchParams.set("to", params.to.toString());
  if (params?.granularity) searchParams.set("granularity", params.granularity);
  const qs = searchParams.toString();
  return request(`/api/analytics${qs ? `?${qs}` : ""}`);
}

/** List agents */
export async function listAgents(): Promise<
  Array<{
    id: string;
    name: string;
    persona: string;
    model: string;
    status: "active" | "inactive";
    tools: string[];
    sessions: number;
    messages: number;
  }>
> {
  return request("/api/agents");
}

/** List skills */
export async function listSkills(): Promise<
  Array<{
    id: string;
    name: string;
    description: string;
    version: string;
    enabled: boolean;
    category?: string;
    triggers: Array<{ type: string; value: string }>;
  }>
> {
  return request("/api/skills");
}

/** Toggle skill */
export async function toggleSkill(id: string, enabled: boolean): Promise<void> {
  return request(`/api/skills/${id}`, { method: "PATCH", body: { enabled } });
}

/** List tools */
export async function listTools(): Promise<
  Array<{
    name: string;
    description: string;
    riskLevel: string;
    requiresApproval: boolean;
    enabled: boolean;
    usageCount: number;
    lastUsedAt?: number;
  }>
> {
  return request("/api/tools");
}

/** Get tool audit log */
export async function getToolAuditLog(params?: {
  tool?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  entries: Array<{
    id: string;
    toolName: string;
    sessionId: string;
    status: string;
    arguments: Record<string, unknown>;
    result?: unknown;
    durationMs?: number;
    timestamp: number;
  }>;
  total: number;
}> {
  const searchParams = new URLSearchParams();
  if (params?.tool) searchParams.set("tool", params.tool);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.offset) searchParams.set("offset", params.offset.toString());
  const qs = searchParams.toString();
  return request(`/api/tools/audit${qs ? `?${qs}` : ""}`);
}

/** Get gateway config */
export async function getConfig(): Promise<Record<string, unknown>> {
  return request("/api/config");
}

/** Update gateway config */
export async function updateConfig(config: Record<string, unknown>): Promise<void> {
  return request("/api/config", { method: "PUT", body: config });
}

export { GatewayError };
