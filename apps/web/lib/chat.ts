import type { ChatMessageUI, ChatSessionUI } from "./store";

export interface GatewaySessionSummary {
  id: string;
  channelType: string;
  channelId: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  stats?: {
    messageCount?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    totalCostUsd?: number;
  };
}

export interface GatewayTranscriptMessage {
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
}

function formatChannelLabel(channelType: string): string {
  return channelType
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }

  return -1;
}

export function mapGatewaySessionToChatSession(session: GatewaySessionSummary): ChatSessionUI {
  const suffix = session.channelId.split("-").at(-1);
  const title =
    session.channelType === "web"
      ? "Web chat"
      : suffix
        ? `${formatChannelLabel(session.channelType)} · ${suffix}`
        : formatChannelLabel(session.channelType);

  return {
    id: session.id,
    title,
    channelType: session.channelType,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.stats?.messageCount ?? 0,
  };
}

export function mapGatewayTranscriptMessage(message: GatewayTranscriptMessage): ChatMessageUI {
  const role: ChatMessageUI["role"] =
    message.role === "user" ||
    message.role === "assistant" ||
    message.role === "system" ||
    message.role === "tool"
      ? message.role
      : "system";

  return {
    id: message.id,
    role,
    content: message.content,
    timestamp: message.timestamp,
    metadata: message.metadata,
  };
}

export function upsertChatSession(
  sessions: ChatSessionUI[],
  nextSession: ChatSessionUI,
): ChatSessionUI[] {
  const existingIndex = sessions.findIndex((session) => session.id === nextSession.id);
  const mergedSessions =
    existingIndex === -1
      ? [...sessions, nextSession]
      : sessions.map((session, index) =>
          index === existingIndex ? { ...session, ...nextSession } : session,
        );

  return [...mergedSessions].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function mergeAssistantResponse(
  messages: ChatMessageUI[],
  response: ChatMessageUI,
  streamingMessageId?: string | null,
): ChatMessageUI[] {
  const streamIndex =
    streamingMessageId
      ? messages.findIndex((message) => message.id === streamingMessageId)
      : findLastIndex(
          messages,
          (message) => message.role === "assistant" && Boolean(message.isStreaming),
        );

  if (streamIndex !== -1) {
    const existing = messages[streamIndex];
    return messages.map((message, index) =>
      index === streamIndex
        ? {
            ...existing,
            ...response,
            id: existing.id,
            isStreaming: false,
          }
        : message,
    );
  }

  const duplicateIndex = findLastIndex(
    messages,
    (message) =>
      message.role === "assistant" &&
      message.content === response.content &&
      Math.abs(message.timestamp - response.timestamp) < 10_000,
  );

  if (duplicateIndex !== -1) {
    const existing = messages[duplicateIndex];
    return messages.map((message, index) =>
      index === duplicateIndex
        ? {
            ...existing,
            ...response,
            id: existing.id,
            isStreaming: false,
          }
        : message,
    );
  }

  return [...messages, response];
}
