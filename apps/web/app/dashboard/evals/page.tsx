"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CircleSlash,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { LineChart } from "@/components/Chart";
import { StatsCard } from "@/components/StatsCard";
import { Badge } from "@/components/Badge";
import { DataTable, type Column } from "@/components/DataTable";
import { cn, formatCost, formatDate } from "@/lib/utils";

type EvalStatus = "passed" | "failed" | "running" | "error";
type StatusFilter = "all" | EvalStatus;

interface EvalRun {
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
}

interface EvalsResponse {
  runs?: EvalRun[];
  total?: number;
  hasMore?: boolean;
}

const statusVariant: Record<EvalStatus, "success" | "danger" | "info" | "warning"> = {
  passed: "success",
  failed: "danger",
  running: "info",
  error: "warning",
};

function statusIcon(status: EvalStatus) {
  switch (status) {
    case "passed":
      return <CheckCircle2 size={14} className="text-success-400" />;
    case "failed":
      return <CircleSlash size={14} className="text-danger-400" />;
    case "running":
      return <Loader2 size={14} className="text-blue-400 animate-spin" />;
    default:
      return <TriangleAlert size={14} className="text-warning-400" />;
  }
}

export default function EvalsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchEvals() {
      setIsLoading(true);
      setError(null);

      try {
        const query = statusFilter === "all" ? "" : `?status=${statusFilter}`;
        const response = await fetch(`/api/evals${query}`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`Evals request failed with ${response.status}`);
        }

        const payload = (await response.json()) as EvalsResponse;
        if (cancelled) return;
        setRuns(payload.runs ?? []);
        setTotal(payload.total ?? (payload.runs ?? []).length);
      } catch (fetchError) {
        if (cancelled) return;
        setRuns([]);
        setTotal(0);
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load eval runs",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    fetchEvals();

    return () => {
      cancelled = true;
    };
  }, [statusFilter, refreshKey]);

  const summary = useMemo(() => {
    const finished = runs.filter((run) => run.status === "passed" || run.status === "failed");
    const passed = runs.filter((run) => run.status === "passed").length;
    const avgScore =
      finished.length > 0
        ? finished.reduce((sum, run) => sum + run.score, 0) / finished.length
        : 0;
    const totalCost = runs.reduce((sum, run) => sum + run.totalCostUsd, 0);
    return { passed, avgScore, totalCost };
  }, [runs]);

  const trendData = useMemo(() => {
    return [...runs]
      .filter((run) => run.finishedAt !== null)
      .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
      .map((run) => ({
        label: formatDate(run.startedAt, "MMM d HH:mm"),
        score: Number((run.score * 100).toFixed(1)),
      }));
  }, [runs]);

  const columns: Column<EvalRun>[] = [
    {
      key: "suite",
      label: "Suite",
      sortable: true,
      render: (_value, row) => (
        <div className="flex items-center gap-2">
          {statusIcon(row.status)}
          <span className="font-medium text-white">{row.suite}</span>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (value) => (
        <Badge variant={statusVariant[value as EvalStatus] ?? "default"}>
          {String(value)}
        </Badge>
      ),
    },
    { key: "model", label: "Model", sortable: true },
    {
      key: "score",
      label: "Score",
      sortable: true,
      render: (value) => `${((value as number) * 100).toFixed(1)}%`,
    },
    {
      key: "passedCases",
      label: "Cases",
      render: (_value, row) => `${row.passedCases}/${row.totalCases}`,
    },
    {
      key: "durationMs",
      label: "Duration",
      sortable: true,
      render: (value) =>
        value == null ? "—" : `${(((value as number) || 0) / 1000).toFixed(1)}s`,
    },
    {
      key: "totalCostUsd",
      label: "Cost",
      sortable: true,
      render: (value) => formatCost((value as number) ?? 0),
    },
    {
      key: "startedAt",
      label: "Started",
      sortable: true,
      render: (value) => formatDate(value as number),
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Eval Results</h1>
          <p className="text-sm text-dark-400 mt-1">
            Eval suite runs with score trends and per-run drill-down
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="rounded-lg border border-dark-700 bg-dark-900 px-3 py-2 text-sm text-dark-200"
          >
            <option value="all">All Statuses</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
            <option value="error">Error</option>
          </select>
          <button
            onClick={() => {
              setIsRefreshing(true);
              setRefreshKey((value) => value + 1);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-dark-700 px-3 py-1.5 text-xs font-medium text-dark-200 transition-colors hover:bg-dark-600"
          >
            <RefreshCw size={14} className={cn(isRefreshing && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Runs"
          value={total.toLocaleString()}
          icon={<CheckCircle2 size={20} />}
        />
        <StatsCard
          title="Passed"
          value={summary.passed.toLocaleString()}
          icon={<CheckCircle2 size={20} />}
        />
        <StatsCard
          title="Avg Score"
          value={`${(summary.avgScore * 100).toFixed(1)}%`}
          icon={<TriangleAlert size={20} />}
        />
        <StatsCard
          title="Total Cost"
          value={formatCost(summary.totalCost)}
          icon={<CircleSlash size={20} />}
        />
      </div>

      <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
        <h3 className="text-sm font-medium text-white mb-4">Score Trend</h3>
        {trendData.length > 0 ? (
          <LineChart
            data={trendData}
            xKey="label"
            yKeys={[{ key: "score", name: "Score (%)", color: "#22c55e" }]}
            height={280}
          />
        ) : (
          <div className="flex items-center justify-center h-[250px] rounded-lg bg-dark-700/30 text-sm text-dark-400">
            No finished eval runs to chart yet.
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading eval runs...
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={runs}
          keyField="id"
          pageSize={15}
          onRowClick={(row) => router.push(`/dashboard/evals/${row.id}`)}
          emptyMessage="No eval runs match the current filter."
        />
      )}

      <p className="text-xs text-dark-500">
        Tip: click a row to open its{" "}
        <Link href="/dashboard/evals" className="text-accent-400 hover:underline">
          per-run detail
        </Link>{" "}
        with every case outcome.
      </p>
    </div>
  );
}
