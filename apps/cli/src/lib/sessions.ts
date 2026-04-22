import type { Session, SessionStatus } from "@karna/shared/types/session.js";

export interface SessionSummary {
  total: number;
  byChannelType: Record<string, number>;
  byStatus: Record<SessionStatus, number>;
  staleSessions: number;
  staleAfterMs: number;
  oldestUpdatedAt?: number;
  newestUpdatedAt?: number;
}

export interface SessionFilterOptions {
  channelType?: string;
  channelId?: string;
  userId?: string;
  status?: SessionStatus;
  limit?: number;
  staleAfterMs?: number;
}

export interface SessionsListResponse {
  sessions: Session[];
  total: number;
}

export async function fetchSessions(
  baseUrl: string,
  filter: SessionFilterOptions = {},
): Promise<SessionsListResponse> {
  const response = await fetch(`${baseUrl}/api/sessions${buildQuery(filter)}`);
  return handleResponse<SessionsListResponse>(response);
}

export async function fetchSession(baseUrl: string, sessionId: string): Promise<Session> {
  const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`);
  const data = await handleResponse<{ session: Session }>(response);
  return data.session;
}

export async function fetchSessionSummary(
  baseUrl: string,
  filter: SessionFilterOptions = {},
): Promise<SessionSummary> {
  const response = await fetch(`${baseUrl}/api/sessions/summary${buildQuery(filter)}`);
  const data = await handleResponse<{ summary: SessionSummary }>(response);
  return data.summary;
}

export async function updateSessionStatus(
  baseUrl: string,
  sessionId: string,
  status: SessionStatus,
): Promise<Session> {
  const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await handleResponse<{ session: Session }>(response);
  return data.session;
}

export async function terminateSession(baseUrl: string, sessionId: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  await handleResponse<{ removed: boolean }>(response);
}

export async function terminateSessions(
  baseUrl: string,
  filter: SessionFilterOptions & { all?: boolean } = {},
): Promise<number> {
  const response = await fetch(`${baseUrl}/api/sessions${buildQuery(filter)}`, {
    method: "DELETE",
  });
  const data = await handleResponse<{ removed: number }>(response);
  return data.removed;
}

function buildQuery(filter: SessionFilterOptions & { all?: boolean }): string {
  const params = new URLSearchParams();

  if (filter.channelType) params.set("channelType", filter.channelType);
  if (filter.channelId) params.set("channelId", filter.channelId);
  if (filter.userId) params.set("userId", filter.userId);
  if (filter.status) params.set("status", filter.status);
  if (typeof filter.limit === "number") params.set("limit", String(filter.limit));
  if (typeof filter.staleAfterMs === "number") params.set("staleAfterMs", String(filter.staleAfterMs));
  if (filter.all) params.set("all", "true");

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
