export interface TraceEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: "ok" | "error" | "cancelled";
  attributes: Record<string, string | number | boolean>;
  events: TraceEvent[];
}

export interface Trace {
  traceId: string;
  sessionId: string;
  agentId: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
  success: boolean;
  error?: string;
  spans: TraceSpan[];
}

export interface TraceStats {
  totalTraces: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  totalTokens: number;
  totalCostUsd: number;
  toolSuccessRate: number;
  errorRate: number;
  tracesPerMinute: number;
}

export interface TraceFilterOptions {
  sessionId?: string;
  agentId?: string;
  limit?: number;
  offset?: number;
  since?: number;
  minDurationMs?: number;
  success?: boolean;
  includeActive?: boolean;
  hasErrors?: boolean;
  toolName?: string;
}

export interface TraceListResponse {
  traces: Trace[];
  total: number;
  active: number;
  filter: TraceFilterOptions;
}

export interface TraceStatsResponse {
  stats: TraceStats;
  periodMs: number;
  activeTraces: number;
  storedTraces: number;
}

export async function fetchTraces(
  baseUrl: string,
  filter: TraceFilterOptions = {},
): Promise<TraceListResponse> {
  const response = await fetch(`${baseUrl}/api/traces${buildQuery(filter)}`);
  return handleResponse<TraceListResponse>(response);
}

export async function fetchTrace(baseUrl: string, traceId: string): Promise<Trace> {
  const response = await fetch(`${baseUrl}/api/traces/${encodeURIComponent(traceId)}`);
  const data = await handleResponse<{ trace: Trace }>(response);
  return data.trace;
}

export async function fetchTraceStats(
  baseUrl: string,
  periodMs?: number,
): Promise<TraceStatsResponse> {
  const query = typeof periodMs === "number" ? `?periodMs=${periodMs}` : "";
  const response = await fetch(`${baseUrl}/api/traces/stats${query}`);
  return handleResponse<TraceStatsResponse>(response);
}

function buildQuery(filter: TraceFilterOptions): string {
  const params = new URLSearchParams();

  if (filter.sessionId) params.set("sessionId", filter.sessionId);
  if (filter.agentId) params.set("agentId", filter.agentId);
  if (typeof filter.limit === "number") params.set("limit", String(filter.limit));
  if (typeof filter.offset === "number") params.set("offset", String(filter.offset));
  if (typeof filter.since === "number") params.set("since", String(filter.since));
  if (typeof filter.minDurationMs === "number") {
    params.set("minDurationMs", String(filter.minDurationMs));
  }
  if (typeof filter.success === "boolean") params.set("success", String(filter.success));
  if (typeof filter.includeActive === "boolean") {
    params.set("includeActive", String(filter.includeActive));
  }
  if (typeof filter.hasErrors === "boolean") params.set("hasErrors", String(filter.hasErrors));
  if (filter.toolName) params.set("toolName", filter.toolName);

  const query = params.toString();
  return query ? `?${query}` : "";
}

async function handleResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data;
}
