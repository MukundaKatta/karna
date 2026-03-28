"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Plus, Play, Pause, Clock, Zap, GitBranch, Trash2, ChevronRight } from "lucide-react";

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
}

const demoWorkflows: Workflow[] = [
  {
    id: "wf-001",
    name: "Daily Code Review",
    description: "Automatically review new PRs every morning and post feedback",
    trigger: { type: "schedule", schedule: "0 9 * * 1-5" },
    nodeCount: 5,
    enabled: true,
    lastRun: { status: "completed", at: Date.now() - 3600000, durationMs: 45000 },
    runs: 23,
    createdAt: Date.now() - 86400000 * 14,
  },
  {
    id: "wf-002",
    name: "Inbox Triage",
    description: "Categorize and summarize unread emails, flag urgent ones",
    trigger: { type: "schedule", schedule: "*/30 * * * *" },
    nodeCount: 7,
    enabled: true,
    lastRun: { status: "completed", at: Date.now() - 1800000, durationMs: 12000 },
    runs: 156,
    createdAt: Date.now() - 86400000 * 30,
  },
  {
    id: "wf-003",
    name: "Bug Report Handler",
    description: "Process incoming bug reports, create tickets, assign to team",
    trigger: { type: "webhook" },
    nodeCount: 6,
    enabled: true,
    lastRun: { status: "failed", at: Date.now() - 7200000, durationMs: 8000 },
    runs: 42,
    createdAt: Date.now() - 86400000 * 7,
  },
  {
    id: "wf-004",
    name: "Weekly Digest",
    description: "Compile weekly activity report with analytics and insights",
    trigger: { type: "schedule", schedule: "0 17 * * 5" },
    nodeCount: 8,
    enabled: false,
    lastRun: { status: "completed", at: Date.now() - 86400000 * 3, durationMs: 120000 },
    runs: 8,
    createdAt: Date.now() - 86400000 * 60,
  },
  {
    id: "wf-005",
    name: "Customer Onboarding",
    description: "Send welcome emails, create accounts, schedule intro call",
    trigger: { type: "event" },
    nodeCount: 9,
    enabled: true,
    runs: 0,
    createdAt: Date.now() - 86400000,
  },
];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "bg-green-500/10 text-green-400 border-green-500/20",
    failed: "bg-red-500/10 text-red-400 border-red-500/20",
    running: "bg-blue-500/10 text-blue-400 border-blue-500/20",
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
  const [workflows, setWorkflows] = useState(demoWorkflows);
  const [showCreate, setShowCreate] = useState(false);

  const toggleEnabled = (id: string) => {
    setWorkflows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w))
    );
  };

  const deleteWorkflow = (id: string) => {
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Workflows</h1>
          <p className="text-dark-400 mt-1">Automate multi-step tasks with visual workflows</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-500 text-white font-medium text-sm transition-colors"
        >
          <Plus size={16} />
          New Workflow
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-xs text-dark-400 mb-1">Total Workflows</p>
          <p className="text-xl font-bold text-white">{workflows.length}</p>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-xs text-dark-400 mb-1">Active</p>
          <p className="text-xl font-bold text-green-400">{workflows.filter((w) => w.enabled).length}</p>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-xs text-dark-400 mb-1">Total Runs</p>
          <p className="text-xl font-bold text-white">{workflows.reduce((a, w) => a + w.runs, 0)}</p>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-xs text-dark-400 mb-1">Failed</p>
          <p className="text-xl font-bold text-red-400">
            {workflows.filter((w) => w.lastRun?.status === "failed").length}
          </p>
        </div>
      </div>

      {/* Workflow Cards */}
      <div className="space-y-3">
        {workflows.map((wf) => (
          <div
            key={wf.id}
            className={cn(
              "rounded-xl border bg-dark-800 p-5 transition-all",
              wf.enabled ? "border-dark-700" : "border-dark-700/50 opacity-60"
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-lg font-semibold text-white">{wf.name}</h3>
                  <TriggerBadge type={wf.trigger.type} />
                  {wf.lastRun && <StatusBadge status={wf.lastRun.status} />}
                </div>
                <p className="text-sm text-dark-400 mb-3">{wf.description}</p>
                <div className="flex items-center gap-4 text-xs text-dark-500">
                  <span>{wf.nodeCount} nodes</span>
                  <span>{wf.runs} runs</span>
                  {wf.trigger.schedule && <span className="font-mono">{wf.trigger.schedule}</span>}
                  {wf.lastRun && (
                    <span>
                      Last run: {Math.round(wf.lastRun.durationMs / 1000)}s ago
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => toggleEnabled(wf.id)}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    wf.enabled
                      ? "text-green-400 hover:bg-green-500/10"
                      : "text-dark-500 hover:bg-dark-700"
                  )}
                  title={wf.enabled ? "Pause" : "Resume"}
                >
                  {wf.enabled ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button
                  onClick={() => deleteWorkflow(wf.id)}
                  className="p-2 rounded-lg text-dark-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
                <ChevronRight size={16} className="text-dark-500" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
