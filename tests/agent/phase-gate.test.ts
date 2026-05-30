import { describe, it, expect, vi } from 'vitest';
import { PhaseGate, PHASE_ORDER } from '../../agent/src/orchestration/phase-gate.js';

describe('PhaseGate transitions', () => {
  it('starts in plan', () => {
    const g = new PhaseGate();
    expect(g.getPhase()).toBe('plan');
    expect(g.isDone()).toBe(false);
  });

  it('advances through plan -> execute -> verify -> done', () => {
    const g = new PhaseGate();
    const seen: string[] = [];
    g.on('transition', ({ from, to }) => seen.push(`${from}->${to}`));
    expect(g.advance()).toBe('execute');
    expect(g.advance()).toBe('verify');
    expect(g.advance()).toBe('done');
    expect(g.isDone()).toBe(true);
    expect(seen).toEqual(['plan->execute', 'execute->verify', 'verify->done']);
  });

  it('emits done event with usage snapshot', () => {
    const g = new PhaseGate();
    const onDone = vi.fn();
    g.on('done', onDone);
    g.transitionTo('done');
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('advance is a no-op once done', () => {
    const g = new PhaseGate();
    g.transitionTo('done');
    expect(g.advance()).toBe('done');
  });

  it('transitionTo supports backward jumps (verify -> execute)', () => {
    const g = new PhaseGate();
    g.advance(); // execute
    g.advance(); // verify
    g.transitionTo('execute');
    expect(g.getPhase()).toBe('execute');
  });

  it('exposes canonical phase order', () => {
    expect(PHASE_ORDER).toEqual(['plan', 'execute', 'verify', 'done']);
  });
});

describe('PhaseGate budgets', () => {
  it('allows spend within budget', () => {
    const g = new PhaseGate({ plan: { maxIterations: 3, maxTokens: 100, maxCostUsd: 1 } });
    expect(g.canSpend({ iterations: 1, tokens: 50 }).allowed).toBe(true);
    const check = g.recordSpend({ iterations: 1, tokens: 50, costUsd: 0.5 });
    expect(check.allowed).toBe(true);
    expect(g.getUsage().tokens).toBe(50);
  });

  it('detects iteration budget overrun', () => {
    const g = new PhaseGate({ plan: { maxIterations: 2 } });
    expect(g.recordSpend().allowed).toBe(true); // 1
    const check = g.recordSpend(); // 2
    expect(check.allowed).toBe(true);
    const over = g.recordSpend(); // 3 -> over
    expect(over.allowed).toBe(false);
    expect(over.exceeded).toContain('iterations');
  });

  it('detects token and cost overruns independently', () => {
    const g = new PhaseGate({ execute: { maxTokens: 100, maxCostUsd: 0.1 } });
    g.advance(); // execute
    const check = g.recordSpend({ tokens: 200, costUsd: 0.5 });
    expect(check.allowed).toBe(false);
    expect(check.exceeded).toEqual(expect.arrayContaining(['tokens', 'costUsd']));
  });

  it('canSpend does not mutate usage', () => {
    const g = new PhaseGate({ plan: { maxTokens: 100 } });
    g.canSpend({ tokens: 50 });
    expect(g.getUsage().tokens).toBe(0);
  });

  it('emits over-budget event', () => {
    const g = new PhaseGate({ plan: { maxIterations: 1 } });
    const onOver = vi.fn();
    g.on('over-budget', onOver);
    g.recordSpend();
    g.recordSpend(); // over
    expect(onOver).toHaveBeenCalledOnce();
    expect(onOver.mock.calls[0][0].phase).toBe('plan');
  });

  it('auto-advances on budget when configured', () => {
    const g = new PhaseGate({ plan: { maxIterations: 1 }, autoAdvanceOnBudget: true });
    g.recordSpend(); // 1, ok, still plan
    expect(g.getPhase()).toBe('plan');
    g.recordSpend(); // over -> auto advance
    expect(g.getPhase()).toBe('execute');
  });

  it('reports remaining budget', () => {
    const g = new PhaseGate({ plan: { maxIterations: 5, maxTokens: 1000 } });
    g.recordSpend({ iterations: 2, tokens: 300 });
    const rem = g.getRemaining('plan');
    expect(rem.iterations).toBe(3);
    expect(rem.tokens).toBe(700);
    expect(rem.costUsd).toBe(Infinity);
  });

  it('throws when recording spend after done', () => {
    const g = new PhaseGate();
    g.transitionTo('done');
    expect(() => g.recordSpend()).toThrow();
  });

  it('reset returns to plan with zero usage', () => {
    const g = new PhaseGate();
    g.recordSpend({ tokens: 10 });
    g.advance();
    g.reset();
    expect(g.getPhase()).toBe('plan');
    expect(g.getUsage().tokens).toBe(0);
  });
});
