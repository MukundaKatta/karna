"use client";

import { useEffect, useMemo, useState } from "react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Plus, Play, Pause, Clock, Zap, GitBranch, Trash2 } from "lucide-react";

interface Workflow {
  id: string;
  name: string;
  description: string;
  trigger: { type: string; schedule?: string };
  nodeCount: number;
  enabled: boolean;
  lastRun?: { status: string; at: number; durationMs: number };
  runs: number;
  createdAt: number;
  updatedAt: number;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "bg-green-500/10 text-green-400 border-green-500/20",
    failed: "bg-red-500/10 text-red-400 border-red-500/20",
    running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    cancelled: "bg-dark-700 text-dark-300 border-dark-600",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-xs border", colors[status] ?? "bg-dark-700 text-dark-400")}>
      {status}
    </span>
  );
}

function TriggerBadge({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    schedule: <Clock size={12} />,
    webhook: <Zap size={12} />,
    event: <GitBranch size={12} />,
    manual: <Play size={12} />,
  };
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-accent-600/10 text-accent-400 border border-accent-500/20">
      {icons[type] ?? <Play size={12} />}
      {type}
    </span>
  );
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyWorkflowId, setBusyWorkflowId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchWorkflows() {
      setIsLoading(true);
      setActionError(null);

      try {
        const response = await fetch("/api/workflows", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Workflow request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { workflows?: Workflow[] };
        if (cancelled) return;
        setWorkflows(payload.workflows ?? []);
      } catch (fetchError) {
        if (cancelled) return;
        setWorkflows([]);
        setActionError(
          fetchError instanceof Error ? fetchError.message : "Failed to load live workflows",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchWorkflows();

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(
    () => ({
      total: workflows.length,
      active: workflows.filter((workflow) => workflow.enabled).length,
      runs: workflows.reduce((sum, workflow) => sum + workflow.runs, 0),
      failed: workflows.filter((workflow) => workflow.lastRun?.status === "failed").length,
    }),
    [workflows],
  );

  const createWorkflow = async () => {
    setIsCreating(true);
    setActionError(null);

    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Starter Workflow ${workflows.length + 1}`,
          description: "A new starter workflow created from the web dashboard.",
          triggerType: "manual",
        }),
      });

      if (!response.ok) {
        throw new Error(`Create request failed with ${response.status}`);
      }

      const payload = (await response.json()) as { workflow?: Workflow };
      if (payload.workflow) {
        setWorkflows((current) => [payload.workflow as Workflow, ...current]);
      }
    } catch (createError) {
      setActionError(
        createError instanceof Error ? createError.message : "Failed to create workflow",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const updateWorkflow = async (workflowId: string, enabled: boolean) => {
    setBusyWorkflowId(workflowId);
    setActionError(null);

    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        throw new Error(`Update request failed with ${response.status}`);
      }

      const payload = (await response.json()) as { workflow?: Workflow };
      if (payload.workflow) {
        setWorkflows((current) =>
          current.map((workflow) =>
            workflow.id === workflowId ? (payload.workflow as Workflow) : workflow,
          ),
        );
      }
    } catch (updateError) {
      setActionError(
        updateError instanceof Error ? updateError.message : "Failed to update workflow",
      );
    } finally {
      setBusyWorkflowId(null);
    }
  };

  const runWorkflow = async (workflowId: string) => {
    setBusyWorkflowId(workflowId);
    setActionError(null);

    try {
      const response = await fetch(`/api/workflows/${workflowId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          triggerData: {
            initiatedFrom: "web-dashboard",
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`Run request failed with ${response.status}`);
      }

      const payload = (await response.json()) as { workflow?: Workflow };
      if (payload.workflow) {
        setWorkflows((current) =>
          current.map((workflow) =>
            workflow.id === workflowId ? (payload.workflow as Workflow) : workflow,
          ),
        );
      }
    } catch (runError) {
      setActionError(runError instanceof Error ? runError.message : "Failed to run workflow");
    } finally {
      setBusyWorkflowId(null);
    }
  };

  const deleteWorkflow = async (workflowId: string) => {
    setBusyWorkflowId(workflowId);
    setActionError(null);

    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Delete request failed with ${response.status}`);
      }

      setWorkflows((current) => current.filter((workflow) => workflow.id !== workflowId));
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete workflow",
      );
    } finally {
      setBusyWorkflowId(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {actionError && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {actionError}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Workflows</h1>
          <p className="text-dark-400 mt-1">Run and operate live workflow definitions from the gateway runtime</p>
        </div>
        <button
          onClick={() => void createWorkflow()}
          disabled={isCreating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
        >
          <Plus size={16} />
          {isCreating ? "Creating..." : "New Workflow"}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-xs text-dark-400 mb-1">Total Workflows</p>
          <p className="text-xl font-bold text-white">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-xs text-dark-400 mb-1">Active</p>
          <p className="text-xl font-bold text-green-400">{stats.active}</p>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-xs text-dark-400 mb-1">Total Runs</p>
          <p className="text-xl font-bold text-white">{stats.runs}</p>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-xs text-dark-400 mb-1">Failed</p>
          <p className="text-xl font-bold text-red-400">{stats.failed}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading live workflows...
        </div>
      ) : workflows.length > 0 ? (
        <div className="space-y-3">
          {workflows.map((workflow) => {
            const busy = busyWorkflowId === workflow.id;

            return (
              <div
                key={workflow.id}
                className={cn(
                  "rounded-xl border bg-dark-800 p-5 transition-all",
                  workflow.enabled ? "border-dark-700" : "border-dark-700/50 opacity-70",
                )}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <h3 className="text-lg font-semibold text-white">{workflow.name}</h3>
                      <TriggerBadge type={workflow.trigger.type} />
                      {workflow.lastRun && <StatusBadge status={workflow.lastRun.status} />}
                    </div>
                    <p className="text-sm text-dark-400 mb-3">{workflow.description}</p>
                    <div className="flex items-center gap-4 text-xs text-dark-500 flex-wrap">
                      <span>{workflow.nodeCount} nodes</span>
                      <span>{workflow.runs} runs</span>
                      {workflow.trigger.schedule && (
                        <span className="font-mono">{workflow.trigger.schedule}</span>
                      )}
                      {workflow.lastRun ? (
                        <span>
                          Last run {formatRelativeTime(workflow.lastRun.at)} in{" "}
                          {Math.max(Math.round(workflow.lastRun.durationMs / 1000), 0)}s
                        </span>
                      ) : (
                        <span>Never run</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 lg:ml-4">
                    <button
                      onClick={() => void runWorkflow(workflow.id)}
                      disabled={busy || !workflow.enabled}
                      className="px-3 py-2 rounded-lg text-sm text-accent-300 bg-accent-500/10 hover:bg-accent-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Run now"
                    >
                      Run now
                    </button>
                    <button
                      onClick={() => void updateWorkflow(workflow.id, !workflow.enabled)}
                      disabled={busy}
                      className={cn(
                        "p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                        workflow.enabled
                          ? "text-green-400 hover:bg-green-500/10"
                          : "text-dark-500 hover:bg-dark-700",
                      )}
                      title={workflow.enabled ? "Pause" : "Resume"}
                    >
                      {workflow.enabled ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <button
                      onClick={() => void deleteWorkflow(workflow.id)}
                      disabled={busy}
                      className="p-2 rounded-lg text-dark-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          No workflows are registered yet.
        </div>
      )}
    </div>
  );
}
