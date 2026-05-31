"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Brain,
  ChevronLeft,
  ChevronRight,
  Coins,
  Eye,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/Badge";
import { cn, formatCost, formatDate, formatTokens } from "@/lib/utils";

type ReplayEventType = "reason" | "act" | "observe";

interface ReplayEvent {
  index: number;
  timestamp: number;
  type: ReplayEventType;
  content: string;
  iteration: number;
  toolName?: string;
  toolCallId?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  durationMs?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}

interface ReplayResponse {
  sessionId: string;
  channelType: string;
  startedAt: number;
  endedAt: number;
  events: ReplayEvent[];
}

const typeMeta: Record<
  ReplayEventType,
  { label: string; icon: React.ReactNode; variant: "info" | "success" | "warning"; accent: string }
> = {
  reason: {
    label: "Reason",
    icon: <Brain size={16} />,
    variant: "info",
    accent: "border-blue-500/40 bg-blue-500/5",
  },
  act: {
    label: "Act",
    icon: <Wrench size={16} />,
    variant: "success",
    accent: "border-green-500/40 bg-green-500/5",
  },
  observe: {
    label: "Observe",
    icon: <Eye size={16} />,
    variant: "warning",
    accent: "border-amber-500/40 bg-amber-500/5",
  },
};

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function SessionReplayPage() {
  const params = useParams();
  const id = params.id as string;
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchReplay() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/sessions/${id}/replay`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "Session replay not found"
              : `Replay request failed with ${response.status}`,
          );
        }

        const payload = (await response.json()) as ReplayResponse;
        if (cancelled) return;
        setReplay(payload);
        setStep(0);
      } catch (fetchError) {
        if (cancelled) return;
        setReplay(null);
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load replay",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchReplay();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const events = useMemo(
    () => [...(replay?.events ?? [])].sort((a, b) => a.index - b.index),
    [replay],
  );
  const total = events.length;
  const safeStep = Math.min(step, Math.max(0, total - 1));
  const current = events[safeStep];

  const runningCost = useMemo(() => {
    return events
      .slice(0, safeStep + 1)
      .reduce((sum, event) => {
        // Cost is not on replay events directly; approximate from token usage when present.
        return sum;
      }, 0);
  }, [events, safeStep]);

  const cumulativeTokens = useMemo(() => {
    return events.slice(0, safeStep + 1).reduce(
      (acc, event) => {
        acc.input += event.inputTokens ?? 0;
        acc.output += event.outputTokens ?? 0;
        return acc;
      },
      { input: 0, output: 0 },
    );
  }, [events, safeStep]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") {
        setStep((value) => Math.min(value + 1, total - 1));
      } else if (event.key === "ArrowLeft") {
        setStep((value) => Math.max(value - 1, 0));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total]);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div className="flex items-start gap-4">
        <Link
          href={`/dashboard/sessions/${id}`}
          className="p-2 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors mt-0.5"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-white">Session Replay</h1>
          <p className="text-sm text-dark-400 mt-1 font-mono break-all">{id}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading replay...
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          No replay events are available for this session yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6">
          {/* Step list */}
          <div className="space-y-2 lg:max-h-[70vh] lg:overflow-y-auto pr-1">
            {events.map((event, idx) => {
              const meta = typeMeta[event.type];
              const isActive = idx === safeStep;
              return (
                <button
                  key={`${event.index}-${event.timestamp}`}
                  onClick={() => setStep(idx)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                    isActive
                      ? "border-accent-500 bg-accent-600/10"
                      : "border-dark-700 bg-dark-800 hover:border-dark-600",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-dark-400 shrink-0">{meta.icon}</span>
                      <span className="text-xs font-medium text-white">{meta.label}</span>
                      {event.toolName && (
                        <span className="text-xs text-dark-400 truncate">
                          {event.toolName}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-dark-500 shrink-0">#{idx + 1}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-dark-500">
                    iter {event.iteration} • {formatDate(event.timestamp, "HH:mm:ss")}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Stepper + detail */}
          <div className="space-y-4">
            <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
              <div className="flex items-center justify-between gap-4">
                <button
                  onClick={() => setStep((value) => Math.max(value - 1, 0))}
                  disabled={safeStep === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-dark-700 px-3 py-2 text-sm text-dark-200 transition-colors hover:bg-dark-600 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} /> Prev
                </button>
                <div className="text-center">
                  <p className="text-sm font-medium text-white">
                    Step {safeStep + 1} / {total}
                  </p>
                  <p className="text-xs text-dark-500">Use ← → arrow keys to navigate</p>
                </div>
                <button
                  onClick={() => setStep((value) => Math.min(value + 1, total - 1))}
                  disabled={safeStep >= total - 1}
                  className="inline-flex items-center gap-2 rounded-lg bg-dark-700 px-3 py-2 text-sm text-dark-200 transition-colors hover:bg-dark-600 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight size={16} />
                </button>
              </div>

              {/* Progress bar */}
              <div className="mt-3 h-1.5 rounded-full bg-dark-900 overflow-hidden">
                <div
                  className="h-full bg-accent-500 transition-all"
                  style={{ width: `${((safeStep + 1) / total) * 100}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <RunningStat
                label="Cumulative Tokens"
                value={formatTokens(cumulativeTokens.input + cumulativeTokens.output)}
              />
              <RunningStat
                label="In / Out Tokens"
                value={`${formatTokens(cumulativeTokens.input)} / ${formatTokens(cumulativeTokens.output)}`}
              />
              <RunningStat
                label="Running Cost"
                value={formatCost(runningCost)}
                icon={<Coins size={14} />}
              />
            </div>

            {current && (
              <div className={cn("rounded-xl border p-5 space-y-4", typeMeta[current.type].accent)}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-dark-300">{typeMeta[current.type].icon}</span>
                    <Badge variant={typeMeta[current.type].variant}>
                      {typeMeta[current.type].label}
                    </Badge>
                    {current.toolName && (
                      <span className="text-sm text-dark-200 font-mono">{current.toolName}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-dark-400">
                    <span>iteration {current.iteration}</span>
                    {current.durationMs != null && <span>{Math.round(current.durationMs)}ms</span>}
                    {current.model && <span>{current.model}</span>}
                    <span>{formatDate(current.timestamp, "HH:mm:ss")}</span>
                  </div>
                </div>

                {current.content && (
                  <div className="text-sm text-dark-200 whitespace-pre-wrap break-words">
                    {current.content}
                  </div>
                )}

                {(current.inputTokens != null || current.outputTokens != null) && (
                  <div className="flex gap-3 text-xs text-dark-400">
                    {current.inputTokens != null && (
                      <span>In: {formatTokens(current.inputTokens)}</span>
                    )}
                    {current.outputTokens != null && (
                      <span>Out: {formatTokens(current.outputTokens)}</span>
                    )}
                  </div>
                )}

                {current.arguments && Object.keys(current.arguments).length > 0 && (
                  <Section label="Tool Arguments" value={stringify(current.arguments)} />
                )}

                {current.result !== undefined && (
                  <Section label="Tool Result" value={stringify(current.result)} />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RunningStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
      <div className="flex items-center gap-2 text-dark-400">
        {icon}
        <p className="text-xs">{label}</p>
      </div>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function Section({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-dark-400 uppercase tracking-wide">{label}</p>
      <pre className="rounded-lg bg-dark-900 border border-dark-700 px-3 py-2 text-xs text-dark-200 whitespace-pre-wrap break-words font-mono max-h-64 overflow-y-auto">
        {value}
      </pre>
    </div>
  );
}
