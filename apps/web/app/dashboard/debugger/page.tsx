"use client";

import { useEffect, useState } from "react";
import { RunDebugger } from "@/components/RunDebugger";
import { normalizeSteps, type RunStep } from "@/components/runTrace";

interface SessionSummary {
  id: string;
  sessionId?: string;
  title?: string;
  channelType?: string;
  createdAt?: string | number;
  startedAt?: string | number;
}

function sessionLabel(session: SessionSummary): string {
  const id = session.id ?? session.sessionId ?? "";
  const created = session.createdAt ?? session.startedAt;
  const when = created ? ` — ${new Date(created).toLocaleString()}` : "";
  return `${session.title ?? session.channelType ?? id}${when}`;
}

export default function DebuggerPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingRun, setLoadingRun] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sessions", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const list: SessionSummary[] = Array.isArray(data)
          ? data
          : (data.sessions ?? []);
        const normalized = list.map((s) => ({ ...s, id: s.id ?? s.sessionId ?? "" }));
        setSessions(normalized);
        if (normalized.length > 0) setSelectedId(normalized[0].id);
        setLoadingSessions(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load sessions");
        setLoadingSessions(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSteps([]);
      return;
    }
    let cancelled = false;
    setLoadingRun(true);
    setError(null);
    // Combine replay (context / step ordering) with traces (tool + memory detail).
    Promise.all([
      fetch(`/api/sessions/${selectedId}/replay`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/sessions/${selectedId}/traces`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([replay, traces]) => {
        if (cancelled) return;
        const replaySteps = normalizeSteps(replay);
        const traceSteps = normalizeSteps(traces);
        // Prefer whichever source produced more steps.
        setSteps(traceSteps.length >= replaySteps.length ? traceSteps : replaySteps);
        setLoadingRun(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load run");
        setLoadingRun(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div>
        <h1 className="text-xl font-semibold text-white">Run Debugger</h1>
        <p className="text-sm text-dark-400 mt-1">
          Inspect assembled context, selected tools, tool args/results, and memory ops per step
        </p>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-dark-400">Session</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={loadingSessions}
          className="px-3 py-2 text-sm bg-dark-800 border border-dark-700 rounded-lg text-dark-200 focus:outline-none focus:border-accent-500 max-w-md"
        >
          {sessions.length === 0 && <option value="">No sessions available</option>}
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {sessionLabel(session)}
            </option>
          ))}
        </select>
      </div>

      {loadingSessions ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading sessions...
        </div>
      ) : loadingRun ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading run trace...
        </div>
      ) : (
        <RunDebugger steps={steps} />
      )}
    </div>
  );
}
