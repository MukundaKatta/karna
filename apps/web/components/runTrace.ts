// apps/web/components/runTrace.ts
// Pure helpers for the run-debugger panel. Framework-free + unit-testable.

export type StepPhase =
  | 'context'
  | 'tool-selection'
  | 'model'
  | 'tool-call'
  | 'memory'
  | 'response'
  | 'other';

export interface ToolCallTrace {
  name: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

export interface MemoryOp {
  op: string;
  tier?: string;
  content?: string;
}

export interface RunStep {
  index: number;
  phase: StepPhase;
  label: string;
  context?: string;
  selectedTools?: string[];
  toolCalls: ToolCallTrace[];
  memoryOps: MemoryOp[];
  raw: Record<string, unknown>;
}

const KNOWN_PHASES: StepPhase[] = [
  'context',
  'tool-selection',
  'model',
  'tool-call',
  'memory',
  'response',
  'other',
];

function coercePhase(value: unknown): StepPhase {
  const s = String(value ?? '').toLowerCase();
  if ((KNOWN_PHASES as string[]).includes(s)) return s as StepPhase;
  if (s.includes('context')) return 'context';
  if (s.includes('select')) return 'tool-selection';
  if (s.includes('model') || s.includes('llm')) return 'model';
  if (s.includes('tool')) return 'tool-call';
  if (s.includes('memory') || s.includes('mem')) return 'memory';
  if (s.includes('response') || s.includes('stream')) return 'response';
  return 'other';
}

function toToolCalls(raw: Record<string, unknown>): ToolCallTrace[] {
  const calls: ToolCallTrace[] = [];
  const candidates =
    (raw.toolCalls as unknown[]) ??
    (raw.tools as unknown[]) ??
    (raw.tool ? [raw.tool] : []);
  if (Array.isArray(candidates)) {
    for (const c of candidates) {
      if (c && typeof c === 'object') {
        const o = c as Record<string, unknown>;
        calls.push({
          name: String(o.name ?? o.tool ?? 'tool'),
          args: o.args ?? o.input,
          result: o.result ?? o.output,
          error: o.error ? String(o.error) : undefined,
          durationMs: typeof o.durationMs === 'number' ? o.durationMs : undefined,
        });
      }
    }
  }
  // Single inline tool call shape: { toolName, args, result }
  if (raw.toolName) {
    calls.push({
      name: String(raw.toolName),
      args: raw.args ?? raw.input,
      result: raw.result ?? raw.output,
      error: raw.error ? String(raw.error) : undefined,
      durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : undefined,
    });
  }
  return calls;
}

function toMemoryOps(raw: Record<string, unknown>): MemoryOp[] {
  const ops: MemoryOp[] = [];
  const candidates = (raw.memoryOps as unknown[]) ?? (raw.memory as unknown[]) ?? [];
  if (Array.isArray(candidates)) {
    for (const c of candidates) {
      if (c && typeof c === 'object') {
        const o = c as Record<string, unknown>;
        ops.push({
          op: String(o.op ?? o.operation ?? o.type ?? 'op'),
          tier: o.tier ? String(o.tier) : undefined,
          content: o.content ? String(o.content) : undefined,
        });
      } else if (typeof c === 'string') {
        ops.push({ op: c });
      }
    }
  }
  return ops;
}

function toStringMaybe(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Normalize replay/trace payloads into a typed list of run steps. */
export function normalizeSteps(data: unknown): RunStep[] {
  const raw =
    (data as { steps?: unknown[] })?.steps ??
    (data as { trace?: unknown[] })?.trace ??
    (data as { traces?: unknown[] })?.traces ??
    (Array.isArray(data) ? data : []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => {
      const selected =
        (s.selectedTools as unknown[]) ?? (s.tools as unknown[]) ?? undefined;
      return {
        index: typeof s.index === 'number' ? s.index : i,
        phase: coercePhase(s.phase ?? s.type ?? s.kind),
        label: String(s.label ?? s.name ?? s.phase ?? s.type ?? `Step ${i + 1}`),
        context: toStringMaybe(s.context ?? s.prompt ?? s.systemPrompt),
        selectedTools: Array.isArray(selected)
          ? selected.map((t) =>
              typeof t === 'string'
                ? t
                : String((t as Record<string, unknown>)?.name ?? t),
            )
          : undefined,
        toolCalls: toToolCalls(s),
        memoryOps: toMemoryOps(s),
        raw: s,
      };
    });
}

/** Distinct phases present in a set of steps, in canonical order. */
export function phasesPresent(steps: RunStep[]): StepPhase[] {
  const present = new Set(steps.map((s) => s.phase));
  return KNOWN_PHASES.filter((p) => present.has(p));
}

export function filterByPhase(steps: RunStep[], phase: StepPhase | 'all'): RunStep[] {
  if (phase === 'all') return steps;
  return steps.filter((s) => s.phase === phase);
}

export function formatValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
