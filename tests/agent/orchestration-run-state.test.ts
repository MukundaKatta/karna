import { describe, it, expect, vi } from 'vitest';
import {
  RunStateMachine,
  InvalidTransitionError,
} from '../../agent/src/orchestration/run-state.js';

describe('RunStateMachine', () => {
  it('starts idle and walks reason -> act -> observe -> done', () => {
    let t = 0;
    const m = new RunStateMachine({ now: () => ++t });
    expect(m.getState()).toBe('idle');
    m.start();
    expect(m.getState()).toBe('reason');
    m.act({ tool: 'search' });
    expect(m.getState()).toBe('act');
    m.observe({ result: 'ok' });
    expect(m.getState()).toBe('observe');
    m.reason();
    m.finish();
    expect(m.getState()).toBe('done');
    expect(m.isTerminal()).toBe(true);
  });

  it('rejects invalid transitions', () => {
    const m = new RunStateMachine();
    // idle can only go to reason.
    expect(() => m.act()).toThrow(InvalidTransitionError);
    expect(m.canTransition('reason')).toBe(true);
    expect(m.canTransition('done')).toBe(false);
  });

  it('cannot transition out of a terminal state', () => {
    const m = new RunStateMachine();
    m.start();
    m.fail({ error: 'boom' });
    expect(m.isTerminal()).toBe(true);
    expect(m.allowedNext()).toEqual([]);
    expect(() => m.reason()).toThrow(InvalidTransitionError);
  });

  it('records serializable events with seq and payload', () => {
    let t = 100;
    const m = new RunStateMachine({ now: () => (t += 5) });
    m.start({ goal: 'x' });
    m.act({ tool: 'write' });
    const history = m.history();
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ seq: 0, from: 'idle', to: 'reason', at: 105, payload: { goal: 'x' } });
    expect(history[1]).toMatchObject({ seq: 1, from: 'reason', to: 'act', payload: { tool: 'write' } });
    // toJSON is JSON round-trippable.
    const json = m.toJSON();
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it('emits transition and terminal events', () => {
    const m = new RunStateMachine();
    const onTransition = vi.fn();
    const onDone = vi.fn();
    m.on('transition', onTransition);
    m.on('done', onDone);
    m.start();
    m.observe();
    m.finish();
    expect(onTransition).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('allowedNext reflects the transition table', () => {
    const m = new RunStateMachine();
    expect(m.allowedNext()).toEqual(['reason']);
    m.start();
    expect(m.allowedNext().sort()).toEqual(['act', 'done', 'failed', 'observe']);
  });
});
