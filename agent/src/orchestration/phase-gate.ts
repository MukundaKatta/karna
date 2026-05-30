import { z } from 'zod';
import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';

/**
 * Issue #522 — Plan-Execute-Verify phase gating.
 *
 * A phase state machine (plan -> execute -> verify -> done) with per-phase
 * budgets (max iterations / tokens / cost). Pure and testable; emits transition
 * events. Designed to be plugged into the runtime later without changing it now.
 */

export const PhaseSchema = z.enum(['plan', 'execute', 'verify', 'done']);
export type Phase = z.infer<typeof PhaseSchema>;

/** Ordered phase progression. `done` is terminal. */
export const PHASE_ORDER: Phase[] = ['plan', 'execute', 'verify', 'done'];

export const PhaseBudgetSchema = z.object({
  // Note: not `.int()` so the default Infinity (and any provided Infinity) is accepted.
  maxIterations: z.number().min(0).default(Number.POSITIVE_INFINITY),
  maxTokens: z.number().min(0).default(Number.POSITIVE_INFINITY),
  maxCostUsd: z.number().min(0).default(Number.POSITIVE_INFINITY),
});

export type PhaseBudget = z.infer<typeof PhaseBudgetSchema>;

export const PhaseGateConfigSchema = z.object({
  plan: PhaseBudgetSchema.optional(),
  execute: PhaseBudgetSchema.optional(),
  verify: PhaseBudgetSchema.optional(),
  /**
   * If true, exceeding a phase budget auto-advances to the next phase instead
   * of throwing. Default false: budget overruns are reported via `canSpend`
   * and `over-budget` events, leaving control to the caller.
   */
  autoAdvanceOnBudget: z.boolean().default(false),
});

export type PhaseGateConfig = z.infer<typeof PhaseGateConfigSchema>;

export interface PhaseUsage {
  iterations: number;
  tokens: number;
  costUsd: number;
}

export interface BudgetCheck {
  allowed: boolean;
  /** Which dimension(s) would be exceeded by the proposed spend. */
  exceeded: Array<'iterations' | 'tokens' | 'costUsd'>;
}

function zeroUsage(): PhaseUsage {
  return { iterations: 0, tokens: 0, costUsd: 0 };
}

function resolveBudget(b?: PhaseBudget): PhaseBudget {
  return PhaseBudgetSchema.parse(b ?? {});
}

/**
 * Phase gate state machine. Tracks the current phase, per-phase usage, and
 * enforces budgets. Time/cost are supplied by the caller (the runtime),
 * keeping this module pure and deterministic.
 */
export class PhaseGate extends EventEmitter {
  private config: PhaseGateConfig;
  private logger?: Logger;
  private current: Phase = 'plan';
  private budgets: Record<Exclude<Phase, 'done'>, PhaseBudget>;
  private usage: Record<Phase, PhaseUsage>;

  constructor(config?: Partial<PhaseGateConfig>, logger?: Logger) {
    super();
    this.config = PhaseGateConfigSchema.parse(config ?? {});
    this.logger = logger;
    this.budgets = {
      plan: resolveBudget(this.config.plan),
      execute: resolveBudget(this.config.execute),
      verify: resolveBudget(this.config.verify),
    };
    this.usage = {
      plan: zeroUsage(),
      execute: zeroUsage(),
      verify: zeroUsage(),
      done: zeroUsage(),
    };
  }

  getPhase(): Phase {
    return this.current;
  }

  isDone(): boolean {
    return this.current === 'done';
  }

  getUsage(phase: Phase = this.current): PhaseUsage {
    return { ...this.usage[phase] };
  }

  getBudget(phase: Exclude<Phase, 'done'>): PhaseBudget {
    return { ...this.budgets[phase] };
  }

  /** Remaining budget for a phase (Infinity dimensions stay Infinity). */
  getRemaining(phase: Exclude<Phase, 'done'> = this.current as Exclude<Phase, 'done'>): PhaseUsage {
    const b = this.budgets[phase];
    const u = this.usage[phase];
    return {
      iterations: b.maxIterations - u.iterations,
      tokens: b.maxTokens - u.tokens,
      costUsd: b.maxCostUsd - u.costUsd,
    };
  }

  /**
   * Check whether a proposed spend fits within the current phase budget,
   * without recording it. `iterations` defaults to 1 (one loop step).
   */
  canSpend(spend: Partial<PhaseUsage> = {}): BudgetCheck {
    if (this.current === 'done') {
      return { allowed: false, exceeded: ['iterations'] };
    }
    const phase = this.current as Exclude<Phase, 'done'>;
    const b = this.budgets[phase];
    const u = this.usage[phase];
    const next = {
      iterations: u.iterations + (spend.iterations ?? 1),
      tokens: u.tokens + (spend.tokens ?? 0),
      costUsd: u.costUsd + (spend.costUsd ?? 0),
    };
    const exceeded: BudgetCheck['exceeded'] = [];
    if (next.iterations > b.maxIterations) exceeded.push('iterations');
    if (next.tokens > b.maxTokens) exceeded.push('tokens');
    if (next.costUsd > b.maxCostUsd) exceeded.push('costUsd');
    return { allowed: exceeded.length === 0, exceeded };
  }

  /**
   * Record actual spend for the current phase. Returns the resulting budget
   * check. If the spend pushes over budget, emits `over-budget`; when
   * `autoAdvanceOnBudget` is set, also advances to the next phase.
   */
  recordSpend(spend: Partial<PhaseUsage> = {}): BudgetCheck {
    if (this.current === 'done') {
      throw new Error('cannot record spend after phase gate is done');
    }
    const phase = this.current as Exclude<Phase, 'done'>;
    const u = this.usage[phase];
    u.iterations += spend.iterations ?? 1;
    u.tokens += spend.tokens ?? 0;
    u.costUsd += spend.costUsd ?? 0;

    const b = this.budgets[phase];
    const exceeded: BudgetCheck['exceeded'] = [];
    if (u.iterations > b.maxIterations) exceeded.push('iterations');
    if (u.tokens > b.maxTokens) exceeded.push('tokens');
    if (u.costUsd > b.maxCostUsd) exceeded.push('costUsd');

    const check: BudgetCheck = { allowed: exceeded.length === 0, exceeded };
    if (!check.allowed) {
      this.logger?.warn({ phase, exceeded, usage: { ...u } }, 'phase over budget');
      this.emit('over-budget', { phase, exceeded, usage: { ...u } });
      if (this.config.autoAdvanceOnBudget) {
        this.advance();
      }
    }
    return check;
  }

  /** Advance to the next phase in the canonical order. Returns the new phase. */
  advance(): Phase {
    if (this.current === 'done') return this.current;
    const idx = PHASE_ORDER.indexOf(this.current);
    const next = PHASE_ORDER[idx + 1];
    const from = this.current;
    this.current = next;
    this.logger?.debug({ from, to: next }, 'phase transition');
    this.emit('transition', { from, to: next });
    if (next === 'done') this.emit('done', { usage: this.snapshotUsage() });
    return next;
  }

  /** Jump straight to a given phase (e.g. verify -> execute on failed verify). */
  transitionTo(target: Phase): void {
    if (target === this.current) return;
    const from = this.current;
    this.current = target;
    this.logger?.debug({ from, to: target }, 'phase transition (explicit)');
    this.emit('transition', { from, to: target });
    if (target === 'done') this.emit('done', { usage: this.snapshotUsage() });
  }

  snapshotUsage(): Record<Phase, PhaseUsage> {
    return {
      plan: { ...this.usage.plan },
      execute: { ...this.usage.execute },
      verify: { ...this.usage.verify },
      done: { ...this.usage.done },
    };
  }

  reset(): void {
    this.current = 'plan';
    this.usage = {
      plan: zeroUsage(),
      execute: zeroUsage(),
      verify: zeroUsage(),
      done: zeroUsage(),
    };
  }
}
