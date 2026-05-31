// apps/web/components/approvals.ts
// Pure helpers for the human-approval-checkpoints UI. Kept framework-free so
// they can be unit-tested without a DOM.

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PendingApproval {
  id: string;
  toolName: string;
  riskLevel: RiskLevel;
  args: Record<string, unknown>;
  sessionId?: string;
  requestedAt?: string;
  reason?: string;
  status?: 'pending' | 'approved' | 'denied';
}

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

const riskVariant: Record<RiskLevel, BadgeVariant> = {
  low: 'success',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};

export function riskBadgeVariant(level: RiskLevel | undefined): BadgeVariant {
  if (!level) return 'default';
  return riskVariant[level] ?? 'default';
}

/** Normalize a raw gateway payload into a typed list of pending approvals. */
export function normalizeApprovals(data: unknown): PendingApproval[] {
  const raw = Array.isArray(data)
    ? data
    : ((data as { approvals?: unknown[] })?.approvals ??
      (data as { pending?: unknown[] })?.pending ??
      []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      id: String(r.id ?? ''),
      toolName: String(r.toolName ?? r.tool ?? r.name ?? 'unknown'),
      riskLevel: (r.riskLevel ?? r.risk ?? 'high') as RiskLevel,
      args:
        r.args && typeof r.args === 'object'
          ? (r.args as Record<string, unknown>)
          : {},
      sessionId: r.sessionId ? String(r.sessionId) : undefined,
      requestedAt: r.requestedAt ? String(r.requestedAt) : undefined,
      reason: r.reason ? String(r.reason) : undefined,
      status: (r.status as PendingApproval['status']) ?? 'pending',
    }))
    .filter((a) => a.id);
}

/** Pretty-print args JSON, falling back to a string on cyclic/invalid input. */
export function formatArgs(args: unknown): string {
  try {
    return JSON.stringify(args ?? {}, null, 2);
  } catch {
    return String(args);
  }
}

/**
 * Parse edited args text back into an object.
 * Returns { ok, value } or { ok:false, error } so the UI can show a message
 * without throwing.
 */
export function parseEditedArgs(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Arguments must be a JSON object.' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
}
