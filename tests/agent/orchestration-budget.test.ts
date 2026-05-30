import { describe, it, expect } from 'vitest';
import {
  PhaseBudgetEnforcer,
  StopReasonSchema,
} from '../../agent/src/orchestration/budget.js';

const INF = Number.POSITIVE_INFINITY;

/** Full PhaseBudget (output-typed) so no casts are needed in tests. */
function budget(overrides: { maxIterations?: number; maxTokens?: number; maxCostUsd?: number }) {
  return {
    maxIterations: overrides.maxIterations ?? INF,
    maxTokens: overrides.maxTokens ?? INF,
    maxCostUsd: overrides.maxCostUsd ?? INF,
  };
}

describe('PhaseBudgetEnforcer', () => {
  it('defaults to unlimited budgets (never stops)', () => {
    const e = new PhaseBudgetEnforcer();
    const r = e.recordSpend('execute', { iterations: 1000, tokens: 1e9, costUsd: 1e6 });
    expect(r.ok).toBe(true);
    expect(r.stopReason).toBeNull();
  });

  it('enforces per-phase iteration cap', () => {
    const e = new PhaseBudgetEnforcer({ phases: { plan: budget({ maxIterations: 2 }) } });
    expect(e.recordSpend('plan').ok).toBe(true);
    expect(e.recordSpend('plan').ok).toBe(true);
    const r = e.recordSpend('plan');
    expect(r.ok).toBe(false);
    expect(r.stopReason).toBe('iterations-exhausted');
  });

  it('enforces per-phase token cap', () => {
    const e = new PhaseBudgetEnforcer({ phases: { execute: budget({ maxTokens: 100 }) } });
    const r = e.recordSpend('execute', { tokens: 150 });
    expect(r.stopReason).toBe('tokens-exhausted');
  });

  it('enforces per-phase cost cap', () => {
    const e = new PhaseBudgetEnforcer({ phases: { verify: budget({ maxCostUsd: 0.5 }) } });
    const r = e.recordSpend('verify', { costUsd: 0.75 });
    expect(r.stopReason).toBe('cost-exhausted');
  });

  it('enforces aggregate total cap across phases', () => {
    const e = new PhaseBudgetEnforcer({ total: budget({ maxTokens: 100 }) });
    expect(e.recordSpend('plan', { tokens: 60 }).ok).toBe(true);
    const r = e.recordSpend('execute', { tokens: 60 });
    expect(r.ok).toBe(false);
    expect(r.stopReason).toBe('total-tokens-exhausted');
    expect(r.totalUsage.tokens).toBe(120);
  });

  it('checkSpend previews without recording', () => {
    const e = new PhaseBudgetEnforcer({ phases: { execute: budget({ maxIterations: 1 }) } });
    expect(e.checkSpend('execute')).toBeNull();
    // Preview did not mutate usage.
    expect(e.getUsage('execute').iterations).toBe(0);
    e.recordSpend('execute');
    expect(e.checkSpend('execute')).toBe('iterations-exhausted');
  });

  it('reset clears usage', () => {
    const e = new PhaseBudgetEnforcer({ phases: { plan: budget({ maxIterations: 1 }) } });
    e.recordSpend('plan');
    e.reset();
    expect(e.getUsage('plan').iterations).toBe(0);
    expect(e.recordSpend('plan').ok).toBe(true);
  });

  it('exposes a stop-reason schema', () => {
    expect(StopReasonSchema.options).toContain('cost-exhausted');
  });
});
