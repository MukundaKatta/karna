// Pure, framework-free logic for the run timeline (#583).
//
// Kept in a `.ts` (not `.tsx`) module so it can be unit-tested under Vitest's
// node environment, which has no JSX transform — mirrors the approvals.ts /
// runTrace.ts split. RunTimeline.tsx re-exports these and adds the React view.

export type RunSpanKind =
  | "context"
  | "model"
  | "tool"
  | "memory"
  | "skill"
  | "handoff"
  | "custom";

export interface RunSpan {
  spanId: string;
  name: string;
  kind: RunSpanKind;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: "ok" | "error" | "cancelled";
}

export interface AgentRun {
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
  spans: RunSpan[];
}

export const kindColor: Record<RunSpanKind, string> = {
  context: "bg-blue-500/60",
  model: "bg-purple-500/60",
  tool: "bg-green-500/60",
  memory: "bg-amber-500/60",
  skill: "bg-cyan-500/60",
  handoff: "bg-pink-500/60",
  custom: "bg-dark-500/60",
};

/**
 * Derive the human-readable current "phase" for a run from its spans.
 * For an active run the phase is the kind of the last still-open span (or the
 * most recent span). For a finished run we report a terminal phase.
 */
export function currentPhase(run: AgentRun): { label: string; tool?: string; kind?: RunSpanKind } {
  if (run.endedAt !== undefined) {
    return { label: run.success ? "completed" : "failed" };
  }
  const openSpan = [...run.spans].reverse().find((span) => span.endedAt === undefined);
  const span = openSpan ?? run.spans[run.spans.length - 1];
  if (!span) {
    return { label: "starting" };
  }
  return {
    label: span.kind,
    tool: span.kind === "tool" ? span.name : undefined,
    kind: span.kind,
  };
}

/** Sort runs for display: active runs first, then most recently started. */
export function sortRuns(runs: AgentRun[]): AgentRun[] {
  return [...runs].sort((a, b) => {
    const aActive = a.endedAt === undefined ? 1 : 0;
    const bActive = b.endedAt === undefined ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return b.startedAt - a.startedAt;
  });
}
