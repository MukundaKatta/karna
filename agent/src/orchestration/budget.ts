import { z } from 'zod';
import type { Logger } from 'pino';
import {
  PhaseBudgetSchema,
  type Phase,
  type PhaseBudget,
  type PhaseUsage,
} from './phase-gate.js';

/**
 * Issue #532 — Per-phase budget caps.
 *
 * Complements {@link PhaseGate} (which embeds budgets inside its phase state
 * machine) with a standalone, reusable budget enforcer. Where `PhaseGate`
 * returns a {@link BudgetCheck} (allowed + exceeded dimensions), this module
 * answers a different question: *should the run stop, and why?* It returns a
 * named {@link StopReason} and supports both per-phase caps and an optional
 * aggregate cap across all phases.
 *
 * Reuses {@link PhaseBudgetSchema} from phase-gate.ts (no duplication of the
 * budget shape). Pure and deterministic: the caller supplies usage.
 */

/** Why a budget enforcer says the run should stop. `null` means "keep going". */
export const StopReasonSchema = z.enum([
  'iterations-exhausted',
  'tokens-exhausted',
  'cost-exhausted',
  'total-iterations-exhausted',
  'total-tokens-exhausted',
  'total-cost-exhausted',
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const PhaseBudgetMapSchema = z.object({
  plan: PhaseBudgetSchema.optional(),
  execute: PhaseBudgetSchema.optional(),
  verify: PhaseBudgetSchema.optional(),
});
export type PhaseBudgetMap = z.infer<typeof PhaseBudgetMapSchema>;

export const PhaseBudgetConfigSchema = z.object({
  /** Per-phase caps. Missing phases default to unlimited. */
  phases: PhaseBudgetMapSchema.default({}),
  /** Optional cap on the sum across all phases. */
  total: PhaseBudgetSchema.optional(),
});
export type PhaseBudgetConfig = z.infer<typeof PhaseBudgetConfigSchema>;

type BudgetPhase = Exclude<Phase, 'done'>;

function zeroUsage(): PhaseUsage {
  return { iterations: 0, tokens: 0, costUsd: 0 };
}

function resolveBudget(b?: PhaseBudget): PhaseBudget {
  return PhaseBudgetSchema.parse(b ?? {});
}

/** The result of charging spend against the budget. */
export interface SpendResult {
  /** True when the spend was accepted without breaching any cap. */
  ok: boolean;
  /** The reason to stop, or null when within budget. */
  stopReason: StopReason | null;
  /** Usage for the phase after applying the spend. */
  phaseUsage: PhaseUsage;
  /** Aggregate usage across all phases after applying the spend. */
  totalUsage: PhaseUsage;
}

/**
 * Enforces iteration/token/cost caps per phase, plus an optional aggregate cap.
 * The caller records spend as it happens; the enforcer reports the first cap
 * breached as a {@link StopReason}.
 */
export class PhaseBudgetEnforcer {
  private readonly config: PhaseBudgetConfig;
  private readonly budgets: Record<BudgetPhase, PhaseBudget>;
  private readonly totalBudget: PhaseBudget;
  private readonly usage: Record<BudgetPhase, PhaseUsage>;
  private readonly logger?: Logger;

  constructor(config?: Partial<PhaseBudgetConfig>, logger?: Logger) {
    this.config = PhaseBudgetConfigSchema.parse(config ?? {});
    this.logger = logger;
    this.budgets = {
      plan: resolveBudget(this.config.phases.plan),
      execute: resolveBudget(this.config.phases.execute),
      verify: resolveBudget(this.config.phases.verify),
    };
    this.totalBudget = resolveBudget(this.config.total);
    this.usage = {
      plan: zeroUsage(),
      execute: zeroUsage(),
      verify: zeroUsage(),
    };
  }

  /** Sum of usage across all phases. */
  totalUsage(): PhaseUsage {
    return (['plan', 'execute', 'verify'] as BudgetPhase[]).reduce<PhaseUsage>(
      (acc, p) => ({
        iterations: acc.iterations + this.usage[p].iterations,
        tokens: acc.tokens + this.usage[p].tokens,
        costUsd: acc.costUsd + this.usage[p].costUsd,
      }),
      zeroUsage(),
    );
  }

  getUsage(phase: BudgetPhase): PhaseUsage {
    return { ...this.usage[phase] };
  }

  getBudget(phase: BudgetPhase): PhaseBudget {
    return { ...this.budgets[phase] };
  }

  /** Compute the first breached stop reason for a hypothetical usage state. */
  private evaluate(phase: BudgetPhase, phaseUsage: PhaseUsage, totalUsage: PhaseUsage): StopReason | null {
    const b = this.budgets[phase];
    if (phaseUsage.iterations > b.maxIterations) return 'iterations-exhausted';
    if (phaseUsage.tokens > b.maxTokens) return 'tokens-exhausted';
    if (phaseUsage.costUsd > b.maxCostUsd) return 'cost-exhausted';
    const t = this.totalBudget;
    if (totalUsage.iterations > t.maxIterations) return 'total-iterations-exhausted';
    if (totalUsage.tokens > t.maxTokens) return 'total-tokens-exhausted';
    if (totalUsage.costUsd > t.maxCostUsd) return 'total-cost-exhausted';
    return null;
  }

  /**
   * Check whether a proposed spend would breach any cap, without recording it.
   * `iterations` defaults to 1. Returns the stop reason, or null if within budget.
   */
  checkSpend(phase: BudgetPhase, spend: Partial<PhaseUsage> = {}): StopReason | null {
    const inc = {
      iterations: spend.iterations ?? 1,
      tokens: spend.tokens ?? 0,
      costUsd: spend.costUsd ?? 0,
    };
    const u = this.usage[phase];
    const nextPhase: PhaseUsage = {
      iterations: u.iterations + inc.iterations,
      tokens: u.tokens + inc.tokens,
      costUsd: u.costUsd + inc.costUsd,
    };
    const total = this.totalUsage();
    const nextTotal: PhaseUsage = {
      iterations: total.iterations + inc.iterations,
      tokens: total.tokens + inc.tokens,
      costUsd: total.costUsd + inc.costUsd,
    };
    return this.evaluate(phase, nextPhase, nextTotal);
  }

  /**
   * Record actual spend against a phase and report whether the run should stop.
   * `iterations` defaults to 1.
   */
  recordSpend(phase: BudgetPhase, spend: Partial<PhaseUsage> = {}): SpendResult {
    const u = this.usage[phase];
    u.iterations += spend.iterations ?? 1;
    u.tokens += spend.tokens ?? 0;
    u.costUsd += spend.costUsd ?? 0;

    const phaseUsage = { ...u };
    const totalUsage = this.totalUsage();
    const stopReason = this.evaluate(phase, phaseUsage, totalUsage);
    if (stopReason) {
      this.logger?.warn({ phase, stopReason, phaseUsage }, 'phase budget exhausted');
    }
    return { ok: stopReason === null, stopReason, phaseUsage, totalUsage };
  }

  reset(): void {
    this.usage.plan = zeroUsage();
    this.usage.execute = zeroUsage();
    this.usage.verify = zeroUsage();
  }
}
