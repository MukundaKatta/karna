import { describe, it, expect } from 'vitest';
import {
  ReActStrategy,
  PlanAndSolveStrategy,
  ReflexionStrategy,
  StrategyRegistry,
  createDefaultStrategyRegistry,
  type StepContext,
  type StrategyStep,
} from '../../agent/src/orchestration/strategies.js';

function ctx(overrides: Partial<StepContext> = {}): StepContext {
  return {
    goal: 'do the thing',
    history: [],
    iteration: 0,
    maxIterations: 10,
    availableTools: ['search', 'write'],
    ...overrides,
  };
}

describe('StrategyRegistry', () => {
  it('registers and retrieves strategies', () => {
    const reg = new StrategyRegistry([new ReActStrategy()]);
    expect(reg.has('react')).toBe(true);
    expect(reg.get('react')?.name).toBe('react');
    expect(reg.require('react').name).toBe('react');
    expect(reg.names()).toEqual(['react']);
  });

  it('throws on duplicate registration', () => {
    const reg = new StrategyRegistry([new ReActStrategy()]);
    expect(() => reg.register(new ReActStrategy())).toThrow(/already registered/);
  });

  it('throws on unknown require', () => {
    const reg = new StrategyRegistry();
    expect(() => reg.require('nope')).toThrow(/unknown orchestration strategy/);
    expect(reg.get('nope')).toBeUndefined();
  });

  it('default registry has the three reference strategies', () => {
    const reg = createDefaultStrategyRegistry();
    expect(reg.names().sort()).toEqual(['plan-and-solve', 'react', 'reflexion']);
    expect(reg.list()).toHaveLength(3);
  });
});

describe('ReActStrategy', () => {
  const s = new ReActStrategy();

  it('finishes immediately when goal already met', () => {
    const a = s.decide(ctx(), { isGoalMet: () => true });
    expect(a.kind).toBe('finish');
    expect(a.finishReason).toBe('goal-met');
  });

  it('acts with a selected tool at the start', () => {
    const a = s.decide(ctx(), { selectTool: () => 'search' });
    expect(a.kind).toBe('act');
    expect(a.tool).toBe('search');
  });

  it('thinks after an act/observe step', () => {
    const history: StrategyStep[] = [{ kind: 'act', success: true, tool: 'search' }];
    const a = s.decide(ctx({ history, iteration: 1 }), { selectTool: () => 'search' });
    expect(a.kind).toBe('think');
  });

  it('finishes when iteration budget exhausted', () => {
    const a = s.decide(ctx({ iteration: 10, maxIterations: 10 }));
    expect(a.kind).toBe('finish');
    expect(a.finishReason).toBe('max-steps');
  });

  it('falls back to think when no tool selected', () => {
    const a = s.decide(ctx());
    expect(a.kind).toBe('think');
  });
});

describe('PlanAndSolveStrategy', () => {
  it('produces a plan on the first turn', () => {
    const s = new PlanAndSolveStrategy(() => ['a', 'b', 'c']);
    const a = s.decide(ctx());
    expect(a.kind).toBe('think');
    expect(a.metadata?.plan).toEqual(['a', 'b', 'c']);
    expect(a.metadata?.planSize).toBe(3);
  });

  it('acts per plan step then finishes when plan complete', () => {
    const s = new PlanAndSolveStrategy(() => ['a', 'b']);
    // After plan (a think) + 2 acts -> finish.
    const history: StrategyStep[] = [
      { kind: 'think', success: true },
      { kind: 'act', success: true },
      { kind: 'act', success: true },
    ];
    const a = s.decide(ctx({ history, iteration: 3 }));
    expect(a.kind).toBe('finish');
    expect(a.finishReason).toBe('plan-complete');
  });

  it('emits an act with plan step metadata mid-plan', () => {
    const s = new PlanAndSolveStrategy(() => ['a', 'b', 'c']);
    const history: StrategyStep[] = [
      { kind: 'think', success: true },
      { kind: 'act', success: true },
    ];
    const a = s.decide(ctx({ history, iteration: 2 }), { selectTool: () => 'write' });
    expect(a.kind).toBe('act');
    expect(a.tool).toBe('write');
    expect(a.metadata?.planStep).toBe(2);
  });

  it('finishes on goal-met regardless of plan', () => {
    const s = new PlanAndSolveStrategy(() => ['a']);
    const a = s.decide(ctx({ history: [{ kind: 'think', success: true }] }), { isGoalMet: () => true });
    expect(a.kind).toBe('finish');
    expect(a.finishReason).toBe('goal-met');
  });
});

describe('ReflexionStrategy', () => {
  it('reflects after a failed act', () => {
    const s = new ReflexionStrategy();
    const history: StrategyStep[] = [{ kind: 'act', success: false, tool: 'write' }];
    const a = s.decide(ctx({ history, iteration: 1 }), { reflect: () => 'lesson learned' });
    expect(a.kind).toBe('reflect');
    expect(a.metadata?.reflection).toBe('lesson learned');
    expect(a.metadata?.reflectionIndex).toBe(1);
  });

  it('retries (acts) after a reflection', () => {
    const s = new ReflexionStrategy();
    const history: StrategyStep[] = [
      { kind: 'act', success: false },
      { kind: 'reflect', success: true },
    ];
    const a = s.decide(ctx({ history, iteration: 2 }), { selectTool: () => 'search' });
    expect(a.kind).toBe('act');
    expect(a.rationale).toContain('retry');
  });

  it('gives up after exhausting reflections', () => {
    const s = new ReflexionStrategy(2);
    const history: StrategyStep[] = [
      { kind: 'act', success: false },
      { kind: 'reflect', success: true },
      { kind: 'act', success: false },
      { kind: 'reflect', success: true },
      { kind: 'act', success: false },
    ];
    const a = s.decide(ctx({ history, iteration: 5 }));
    expect(a.kind).toBe('finish');
    expect(a.finishReason).toBe('no-progress');
  });

  it('finishes on goal-met', () => {
    const s = new ReflexionStrategy();
    const a = s.decide(ctx(), { isGoalMet: () => true });
    expect(a.kind).toBe('finish');
    expect(a.finishReason).toBe('goal-met');
  });
});
