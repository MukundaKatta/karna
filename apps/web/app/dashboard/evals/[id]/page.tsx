"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash,
  Clock,
  Coins,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/Badge";
import { StatsCard } from "@/components/StatsCard";
import { cn, formatCost, formatDate } from "@/lib/utils";

type EvalStatus = "passed" | "failed" | "running" | "error";
type CaseStatus = "passed" | "failed" | "error";

interface EvalCase {
  id: string;
  name: string;
  status: CaseStatus;
  input: string;
  expected: string | null;
  actual: string | null;
  scores: Record<string, number>;
  durationMs: number;
  costUsd: number;
  error: string | null;
}

interface EvalRunDetail {
  id: string;
  suite: string;
  status: EvalStatus;
  model: string;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  score: number;
  totalCostUsd: number;
  cases: EvalCase[];
}

const statusVariant: Record<EvalStatus, "success" | "danger" | "info" | "warning"> = {
  passed: "success",
  failed: "danger",
  running: "info",
  error: "warning",
};

const caseVariant: Record<CaseStatus, "success" | "danger" | "warning"> = {
  passed: "success",
  failed: "danger",
  error: "warning",
};

function runIcon(status: EvalStatus) {
  switch (status) {
    case "passed":
      return <CheckCircle2 size={20} />;
    case "failed":
      return <CircleSlash size={20} />;
    case "running":
      return <Loader2 size={20} className="animate-spin" />;
    default:
      return <TriangleAlert size={20} />;
  }
}

export default function EvalRunDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [run, setRun] = useState<EvalRunDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | CaseStatus>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function fetchRun() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/evals/${id}`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "Eval run not found"
              : `Eval run request failed with ${response.status}`,
          );
        }

        const payload = (await response.json()) as EvalRunDetail;
        if (cancelled) return;
        setRun(payload);
      } catch (fetchError) {
        if (cancelled) return;
        setRun(null);
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load eval run",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchRun();

    return () => {
      cancelled = true;
    };
  }, [id]);

  const cases = run?.cases ?? [];
  const filteredCases = useMemo(
    () =>
      statusFilter === "all"
        ? cases
        : cases.filter((evalCase) => evalCase.status === statusFilter),
    [cases, statusFilter],
  );

  const toggle = (caseId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) {
        next.delete(caseId);
      } else {
        next.add(caseId);
      }
      return next;
    });
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div className="flex items-start gap-4">
        <Link
          href="/dashboard/evals"
          className="p-2 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700 transition-colors mt-0.5"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-white">{run?.suite ?? id}</h1>
            {run && (
              <Badge variant={statusVariant[run.status] ?? "default"}>{run.status}</Badge>
            )}
          </div>
          <p className="text-sm text-dark-400 mt-1 font-mono">{id}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading eval run...
        </div>
      ) : !run ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Eval run not found.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard
              title="Score"
              value={`${(run.score * 100).toFixed(1)}%`}
              icon={runIcon(run.status)}
            />
            <StatsCard
              title="Cases"
              value={`${run.passedCases}/${run.totalCases}`}
              icon={<CheckCircle2 size={20} />}
            />
            <StatsCard
              title="Duration"
              value={run.durationMs == null ? "—" : `${(run.durationMs / 1000).toFixed(1)}s`}
              icon={<Clock size={20} />}
            />
            <StatsCard
              title="Cost"
              value={formatCost(run.totalCostUsd)}
              icon={<Coins size={20} />}
            />
          </div>

          <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
            <h3 className="text-sm font-medium text-white mb-4">Run Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <DetailRow label="Model" value={run.model} />
              <DetailRow label="Started" value={formatDate(run.startedAt)} />
              <DetailRow
                label="Finished"
                value={run.finishedAt == null ? "Running" : formatDate(run.finishedAt)}
              />
              <DetailRow
                label="Passed / Failed"
                value={`${run.passedCases} / ${run.failedCases}`}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-medium text-white">
              Cases <span className="text-dark-500">({filteredCases.length})</span>
            </h3>
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "all" | CaseStatus)
              }
              className="rounded-lg border border-dark-700 bg-dark-900 px-3 py-2 text-sm text-dark-200"
            >
              <option value="all">All Cases</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="error">Error</option>
            </select>
          </div>

          {filteredCases.length > 0 ? (
            <div className="space-y-2">
              {filteredCases.map((evalCase) => {
                const isOpen = expanded.has(evalCase.id);
                return (
                  <div
                    key={evalCase.id}
                    className="rounded-xl border border-dark-700 bg-dark-800 overflow-hidden"
                  >
                    <button
                      onClick={() => toggle(evalCase.id)}
                      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-dark-700/40 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {isOpen ? (
                          <ChevronDown size={16} className="text-dark-500 shrink-0" />
                        ) : (
                          <ChevronRight size={16} className="text-dark-500 shrink-0" />
                        )}
                        <Badge variant={caseVariant[evalCase.status] ?? "default"}>
                          {evalCase.status}
                        </Badge>
                        <span className="text-sm font-medium text-white truncate">
                          {evalCase.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-dark-400 shrink-0">
                        <span>{(evalCase.durationMs / 1000).toFixed(1)}s</span>
                        <span>{formatCost(evalCase.costUsd)}</span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-dark-700 px-4 py-4 space-y-4">
                        {Object.keys(evalCase.scores ?? {}).length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(evalCase.scores).map(([metric, value]) => (
                              <span
                                key={metric}
                                className="inline-flex items-center gap-1 rounded-md bg-dark-900 border border-dark-700 px-2 py-1 text-xs text-dark-300"
                              >
                                <span className="text-dark-400">{metric}:</span>
                                <span className="text-dark-100 font-medium">
                                  {value.toFixed(2)}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}

                        {evalCase.error && (
                          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-300 whitespace-pre-wrap break-words">
                            {evalCase.error}
                          </div>
                        )}

                        <CaseField label="Input" value={evalCase.input} />
                        {evalCase.expected != null && (
                          <CaseField label="Expected" value={evalCase.expected} />
                        )}
                        {evalCase.actual != null && (
                          <CaseField label="Actual" value={evalCase.actual} />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
              No cases match the current filter.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-dark-400">{label}</p>
      <p className="text-dark-200 break-words">{value}</p>
    </div>
  );
}

function CaseField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-dark-400 uppercase tracking-wide">{label}</p>
      <pre className={cn(
        "rounded-lg bg-dark-900 border border-dark-700 px-3 py-2 text-xs text-dark-200",
        "whitespace-pre-wrap break-words font-mono max-h-64 overflow-y-auto",
      )}>
        {value}
      </pre>
    </div>
  );
}
