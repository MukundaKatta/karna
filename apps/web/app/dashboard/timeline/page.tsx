"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Coins, Hash, Pause, Play, Sparkles } from "lucide-react";
import { StatsCard } from "@/components/StatsCard";
import { RunTimeline, type AgentRun } from "@/components/RunTimeline";
import { cn, formatCost, formatTokens } from "@/lib/utils";

interface TraceListResponse {
  traces?: AgentRun[];
  total?: number;
  active?: number;
}

const POLL_INTERVAL_MS = 3000;
const WINDOW_MS = 3_600_000; // last hour

export default function TimelinePage() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const initialLoad = useRef(true);

  const fetchRuns = useCallback(async () => {
    const since = Date.now() - WINDOW_MS;
    try {
      const response = await fetch(
        `/api/traces?includeActive=true&limit=60&since=${since}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(`Traces request failed with ${response.status}`);
      }
      const payload = (await response.json()) as TraceListResponse;
      const nextRuns = payload.traces ?? [];
      setRuns(nextRuns);
      setActiveCount(
        payload.active ??
          nextRuns.filter((run) => run.endedAt === undefined).length,
      );
      setError(null);
      setLastUpdated(Date.now());
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : "Failed to load runs",
      );
    } finally {
      if (initialLoad.current) {
        initialLoad.current = false;
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(fetchRuns, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [live, fetchRuns]);

  const runningCost = runs.reduce((sum, run) => sum + run.costUsd, 0);
  const runningTokens = runs.reduce(
    (sum, run) => sum + run.inputTokens + run.outputTokens,
    0,
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-dark-400">
        Loading timeline...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Run Timeline</h1>
          <p className="text-sm text-dark-400 mt-1">
            Live agent runs with current phase, active tool, and running cost
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs text-dark-500">
              updated {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => setLive((value) => !value)}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              live
                ? "bg-accent-600 text-white hover:bg-accent-500"
                : "bg-dark-700 text-dark-200 hover:bg-dark-600",
            )}
          >
            {live ? <Pause size={14} /> : <Play size={14} />}
            {live ? "Live" : "Paused"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Active Runs"
          value={activeCount.toLocaleString()}
          icon={<Sparkles size={20} />}
        />
        <StatsCard
          title="Runs (1h)"
          value={runs.length.toLocaleString()}
          icon={<Activity size={20} />}
        />
        <StatsCard
          title="Tokens (1h)"
          value={formatTokens(runningTokens)}
          icon={<Hash size={20} />}
        />
        <StatsCard
          title="Cost (1h)"
          value={formatCost(runningCost)}
          icon={<Coins size={20} />}
        />
      </div>

      <RunTimeline runs={runs} />
    </div>
  );
}
