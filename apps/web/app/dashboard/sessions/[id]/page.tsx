"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, Clock, Hash, Coins, MessageSquare } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/Badge";
import { formatDate, formatRelativeTime, formatCost, formatTokens } from "@/lib/utils";

interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
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

interface SessionDetail {
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

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSessionDetail() {
      setIsLoading(true);
      setError(null);

      try {
        const [sessionResponse, historyResponse] = await Promise.all([
          fetch(`/api/sessions/${id}`, { cache: "no-store" }),
          fetch(`/api/sessions/${id}/history?limit=200`, { cache: "no-store" }),
        ]);

        if (!sessionResponse.ok) {
          throw new Error(
            sessionResponse.status === 404
              ? "Session not found"
              : `Session request failed with ${sessionResponse.status}`,
          );
        }
        if (!historyResponse.ok && historyResponse.status !== 404) {
          throw new Error(`Transcript request failed with ${historyResponse.status}`);
        }

        const sessionPayload = (await sessionResponse.json()) as { session?: SessionDetail };
        const historyPayload = historyResponse.ok
          ? ((await historyResponse.json()) as {
              messages?: TranscriptMessage[];
              totalMessages?: number;
            })
          : { messages: [], totalMessages: 0 };

        if (cancelled) return;

        setSession(sessionPayload.session ?? null);
        setMessages(historyPayload.messages ?? []);
        setTotalMessages(historyPayload.totalMessages ?? 0);
      } catch (fetchError) {
        if (cancelled) return;
        setSession(null);
        setMessages([]);
        setTotalMessages(0);
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load session");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchSessionDetail();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const durationMs = useMemo(() => {
    if (!session) return 0;
    return Math.max(session.updatedAt - session.createdAt, 0);
  }, [session]);

  const roleStyles: Record<string, string> = {
    user: "bg-accent-600/10 border-accent-600/20",
    assistant: "bg-dark-700/50 border-dark-600",
    system: "bg-dark-800 border-dark-700 italic",
    tool: "bg-dark-800 border-dark-700 font-mono text-xs",
  };

  const roleLabels: Record<string, string> = {
    user: "User",
    assistant: "Assistant",
    system: "System",
    tool: "Tool",
  };

  return (
    <div className="p-6 space-y-6">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div className="flex items-start gap-4">
        <Link
          href="/dashboard/sessions"
          className="p-2 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors mt-0.5"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-white font-mono">{id}</h1>
            {session && (
              <Badge variant={session.status === "active" ? "success" : "default"}>
                {session.status}
              </Badge>
            )}
          </div>
          <p className="text-sm text-dark-400 mt-1">
            {session
              ? `${session.channelType} / ${session.channelId} · Started ${formatRelativeTime(session.createdAt)}`
              : "Loading live session detail"}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading live session detail...
        </div>
      ) : !session ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Session not found.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-3">
            <div className="rounded-lg border border-dark-700 bg-dark-800 px-4 py-3 text-xs text-dark-400">
              Showing {messages.length} transcript messages
              {totalMessages > messages.length ? ` of ${totalMessages}` : ""}
            </div>

            {messages.length ? (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-xl border p-4 ${roleStyles[msg.role]}`}
                >
                  <div className="flex items-center justify-between mb-2 gap-3">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          msg.role === "user"
                            ? "accent"
                            : msg.role === "assistant"
                              ? "info"
                              : msg.role === "tool"
                                ? "warning"
                                : "default"
                        }
                      >
                        {roleLabels[msg.role]}
                      </Badge>
                      {msg.metadata?.toolName && (
                        <span className="text-xs text-dark-400">{msg.metadata.toolName}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-dark-500 flex-wrap justify-end">
                      {msg.metadata?.latencyMs && <span>{msg.metadata.latencyMs}ms</span>}
                      {msg.metadata?.model && <span>{msg.metadata.model}</span>}
                      <span>{formatDate(msg.timestamp, "HH:mm:ss")}</span>
                    </div>
                  </div>
                  <div className="text-sm text-dark-200 whitespace-pre-wrap break-words">
                    {msg.content}
                  </div>
                  {(msg.metadata?.inputTokens || msg.metadata?.outputTokens) && (
                    <div className="flex gap-3 mt-2 text-xs text-dark-500">
                      {msg.metadata.inputTokens && (
                        <span>In: {formatTokens(msg.metadata.inputTokens)}</span>
                      )}
                      {msg.metadata.outputTokens && (
                        <span>Out: {formatTokens(msg.metadata.outputTokens)}</span>
                      )}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
                No transcript messages are available for this session yet.
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-dark-700 bg-dark-800 p-4 space-y-4">
              <h3 className="text-sm font-medium text-white">Session Stats</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <MessageSquare size={16} className="text-dark-400" />
                  <div>
                    <p className="text-xs text-dark-400">Messages</p>
                    <p className="text-sm font-medium text-white">
                      {session.stats?.messageCount ?? totalMessages}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Hash size={16} className="text-dark-400" />
                  <div>
                    <p className="text-xs text-dark-400">Total Tokens</p>
                    <p className="text-sm font-medium text-white">
                      {formatTokens(
                        (session.stats?.totalInputTokens ?? 0) +
                          (session.stats?.totalOutputTokens ?? 0),
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Coins size={16} className="text-dark-400" />
                  <div>
                    <p className="text-xs text-dark-400">Cost</p>
                    <p className="text-sm font-medium text-white">
                      {formatCost(session.stats?.totalCostUsd ?? 0)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Clock size={16} className="text-dark-400" />
                  <div>
                    <p className="text-xs text-dark-400">Duration</p>
                    <p className="text-sm font-medium text-white">
                      {Math.round(durationMs / 1000)}s
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-dark-700 bg-dark-800 p-4 space-y-3">
              <h3 className="text-sm font-medium text-white">Details</h3>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-dark-400">Channel</p>
                  <p className="text-dark-200">{session.channelType}</p>
                </div>
                <div>
                  <p className="text-xs text-dark-400">Channel ID</p>
                  <p className="text-dark-200 font-mono text-xs break-all">{session.channelId}</p>
                </div>
                <div>
                  <p className="text-xs text-dark-400">Created</p>
                  <p className="text-dark-200">{formatDate(session.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-dark-400">Last Active</p>
                  <p className="text-dark-200">{formatDate(session.updatedAt)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
