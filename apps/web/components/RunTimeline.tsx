"use client";

import { useMemo } from "react";
import { Activity, CheckCircle2, Coins, XCircle } from "lucide-react";
import { Badge } from "@/components/Badge";
import { cn, formatCost, formatTokens } from "@/lib/utils";
import {
  currentPhase,
  kindColor,
  sortRuns,
  type AgentRun,
  type RunSpan,
  type RunSpanKind,
} from "@/components/run-timeline";

// Re-export the pure logic/types so existing importers of this component keep working.
export { currentPhase, sortRuns };
export type { AgentRun, RunSpan, RunSpanKind };

export function RunTimeline({
  runs,
  className,
}: {
  runs: AgentRun[];
  className?: string;
}) {
  const sorted = useMemo(() => sortRuns(runs), [runs]);

  if (sorted.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400",
          className,
        )}
      >
        No agent runs are active right now.
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {sorted.map((run) => {
        const isActive = run.endedAt === undefined;
        const phase = currentPhase(run);
        const totalDuration = Math.max(
          run.durationMs ?? Date.now() - run.startedAt,
          1,
        );

        return (
          <div
            key={run.traceId}
            className={cn(
              "rounded-xl border p-4",
              isActive ? "border-accent-500/60 bg-accent-600/5" : "border-dark-700 bg-dark-800",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {isActive ? (
                    <Badge variant="info">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-400" />
                        </span>
                        running
                      </span>
                    </Badge>
                  ) : run.success ? (
                    <Badge variant="success">
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 size={12} /> done
                      </span>
                    </Badge>
                  ) : (
                    <Badge variant="danger">
                      <span className="inline-flex items-center gap-1">
                        <XCircle size={12} /> error
                      </span>
                    </Badge>
                  )}
                  <span className="text-sm font-medium text-white truncate">
                    {run.agentId}
                  </span>
                  <span className="text-xs text-dark-500">{run.model || "unknown model"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-dark-400">
                  <span className="inline-flex items-center gap-1">
                    <Activity size={12} />
                    phase:{" "}
                    <span className="text-dark-200 font-medium">
                      {phase.tool ? `tool · ${phase.tool}` : phase.label}
                    </span>
                  </span>
                  <span>session {run.sessionId}</span>
                  <span>{run.toolCalls} tools</span>
                </div>
              </div>

              <div className="text-right text-xs text-dark-400 shrink-0 space-y-1">
                <p className="inline-flex items-center gap-1 text-dark-200">
                  <Coins size={12} /> {formatCost(run.costUsd)}
                </p>
                <p>{formatTokens(run.inputTokens + run.outputTokens)} tokens</p>
                <p>{Math.round(totalDuration)}ms</p>
              </div>
            </div>

            {/* Span timeline bar */}
            <div className="mt-3 h-6 relative overflow-hidden rounded bg-dark-900">
              {run.spans.map((span) => {
                const offset = ((span.startedAt - run.startedAt) / totalDuration) * 100;
                const spanDuration =
                  span.durationMs ??
                  (span.endedAt !== undefined
                    ? span.endedAt - span.startedAt
                    : Date.now() - span.startedAt);
                const width = Math.max(2, (Math.max(spanDuration, 1) / totalDuration) * 100);
                const isOpen = span.endedAt === undefined;
                return (
                  <div
                    key={span.spanId}
                    className={cn(
                      "absolute top-1 h-4 rounded-sm",
                      span.status === "error" ? "bg-red-500/60" : kindColor[span.kind],
                      isOpen && "animate-pulse",
                    )}
                    style={{
                      left: `${Math.min(Math.max(offset, 0), 100)}%`,
                      width: `${Math.min(width, 100)}%`,
                    }}
                    title={`${span.kind}: ${span.name} (${Math.round(spanDuration)}ms)${isOpen ? " — running" : ""}`}
                  />
                );
              })}
            </div>

            {run.error && (
              <p className="mt-2 text-xs text-red-300 break-words">{run.error}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
