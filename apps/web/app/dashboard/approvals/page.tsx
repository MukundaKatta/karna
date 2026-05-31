"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";
import {
  formatArgs,
  normalizeApprovals,
  parseEditedArgs,
  riskBadgeVariant,
  type PendingApproval,
} from "@/components/approvals";

const POLL_MS = 4000;

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PendingApproval | null>(null);
  const [editText, setEditText] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const firstLoad = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed with ${res.status}`);
      const data = await res.json();
      setApprovals(normalizeApprovals(data).filter((a) => a.status === "pending"));
      setError(null);
    } catch (e) {
      // Keep last-known list on transient poll errors; only surface on first load.
      if (firstLoad.current) {
        setError(e instanceof Error ? e.message : "Failed to load approvals");
      }
    } finally {
      if (firstLoad.current) {
        firstLoad.current = false;
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function decide(
    approval: PendingApproval,
    decision: "approve" | "deny",
    args?: Record<string, unknown>,
  ) {
    setBusyId(approval.id);
    try {
      const res = await fetch(`/api/approvals/${approval.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, ...(args ? { args } : {}) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Decision failed with ${res.status}`);
      }
      setApprovals((prev) => prev.filter((x) => x.id !== approval.id));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(approval: PendingApproval) {
    setEditing(approval);
    setEditText(formatArgs(approval.args));
    setEditError(null);
  }

  function submitEdit() {
    if (!editing) return;
    const parsed = parseEditedArgs(editText);
    if (!parsed.ok) {
      setEditError(parsed.error);
      return;
    }
    decide(editing, "approve", parsed.value);
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-400">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Approvals</h1>
          <p className="text-sm text-dark-400 mt-1">
            High-risk tool calls awaiting your decision. Updates automatically.
          </p>
        </div>
        {approvals.length > 0 && (
          <Badge variant="warning">{approvals.length} pending</Badge>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          Loading pending approvals...
        </div>
      ) : approvals.length === 0 ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
          <ShieldAlert size={28} className="mx-auto mb-3 text-success-400" />
          No pending approvals. You&apos;re all caught up.
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((approval) => (
            <div
              key={approval.id}
              className="rounded-xl border border-dark-700 bg-dark-800 p-5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-medium text-dark-100">
                    {approval.toolName}
                  </code>
                  <Badge variant={riskBadgeVariant(approval.riskLevel)}>
                    {approval.riskLevel}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-dark-500">
                  {approval.sessionId && (
                    <span className="font-mono">
                      session {approval.sessionId.slice(0, 8)}
                    </span>
                  )}
                  {approval.requestedAt && (
                    <span>{new Date(approval.requestedAt).toLocaleString()}</span>
                  )}
                </div>
              </div>

              {approval.reason && (
                <p className="text-sm text-dark-400">{approval.reason}</p>
              )}

              <pre className="max-h-60 overflow-auto rounded-lg bg-dark-900/70 p-3 text-xs text-dark-300">
                {formatArgs(approval.args)}
              </pre>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => decide(approval, "approve")}
                  disabled={busyId === approval.id}
                  className="rounded-lg bg-success-500/20 px-4 py-2 text-sm font-medium text-success-400 hover:bg-success-500/30 disabled:opacity-50 transition-colors"
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(approval, "deny")}
                  disabled={busyId === approval.id}
                  className="rounded-lg bg-danger-500/20 px-4 py-2 text-sm font-medium text-danger-400 hover:bg-danger-500/30 disabled:opacity-50 transition-colors"
                >
                  Deny
                </button>
                <button
                  onClick={() => openEdit(approval)}
                  disabled={busyId === approval.id}
                  className="rounded-lg bg-dark-700 px-4 py-2 text-sm text-white hover:bg-dark-600 disabled:opacity-50 transition-colors"
                >
                  Edit args
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Edit args — ${editing.toolName}` : undefined}
        size="lg"
      >
        <p className="mb-2 text-sm text-dark-400">
          Edit the arguments below, then approve with the modified call.
        </p>
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          spellCheck={false}
          rows={12}
          className="w-full rounded-lg border border-dark-700 bg-dark-900/70 p-3 font-mono text-xs text-dark-200 focus:outline-none focus:border-accent-500"
        />
        {editError && <div className="mt-2 text-sm text-danger-400">{editError}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setEditing(null)}
            className="rounded-lg bg-dark-700 px-4 py-2 text-sm text-white hover:bg-dark-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submitEdit}
            disabled={!!busyId}
            className="rounded-lg bg-success-500/20 px-4 py-2 text-sm font-medium text-success-400 hover:bg-success-500/30 disabled:opacity-50 transition-colors"
          >
            Approve with edits
          </button>
        </div>
      </Modal>
    </div>
  );
}
