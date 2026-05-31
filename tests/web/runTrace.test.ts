import { describe, it, expect } from 'vitest';
import {
  normalizeSteps,
  phasesPresent,
  filterByPhase,
  formatValue,
} from '../../apps/web/components/runTrace';

describe('normalizeSteps', () => {
  it('reads { steps } and assigns indexes', () => {
    const out = normalizeSteps({
      steps: [
        { phase: 'context', context: 'hi' },
        { phase: 'model' },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0].index).toBe(0);
    expect(out[0].phase).toBe('context');
    expect(out[0].context).toBe('hi');
  });

  it('coerces fuzzy phase names', () => {
    const out = normalizeSteps([
      { type: 'llm-call' },
      { type: 'tool_selection' },
      { type: 'persist-memory' },
      { type: 'weird' },
    ]);
    expect(out[0].phase).toBe('model');
    expect(out[1].phase).toBe('tool-selection');
    expect(out[2].phase).toBe('memory');
    expect(out[3].phase).toBe('other');
  });

  it('extracts inline and array tool calls', () => {
    const inline = normalizeSteps([
      { phase: 'tool-call', toolName: 'shell', args: { c: 1 }, result: 'ok' },
    ]);
    expect(inline[0].toolCalls).toHaveLength(1);
    expect(inline[0].toolCalls[0].name).toBe('shell');
    expect(inline[0].toolCalls[0].result).toBe('ok');

    const arr = normalizeSteps([
      { phase: 'tool-call', toolCalls: [{ name: 'http', input: {}, output: 1 }] },
    ]);
    expect(arr[0].toolCalls[0].name).toBe('http');
    expect(arr[0].toolCalls[0].args).toEqual({});
    expect(arr[0].toolCalls[0].result).toBe(1);
  });

  it('extracts memory ops and selected tools', () => {
    const out = normalizeSteps([
      {
        phase: 'memory',
        selectedTools: ['a', { name: 'b' }],
        memoryOps: [{ op: 'promote', tier: 'long-term' }, 'noted'],
      },
    ]);
    expect(out[0].selectedTools).toEqual(['a', 'b']);
    expect(out[0].memoryOps).toEqual([
      { op: 'promote', tier: 'long-term', content: undefined },
      { op: 'noted' },
    ]);
  });

  it('handles trace/traces wrappers and bad input', () => {
    expect(normalizeSteps({ trace: [{ phase: 'model' }] })).toHaveLength(1);
    expect(normalizeSteps({ traces: [{ phase: 'model' }] })).toHaveLength(1);
    expect(normalizeSteps(null)).toEqual([]);
  });
});

describe('phasesPresent / filterByPhase', () => {
  const steps = normalizeSteps([
    { phase: 'context' },
    { phase: 'model' },
    { phase: 'context' },
  ]);
  it('returns distinct phases in canonical order', () => {
    expect(phasesPresent(steps)).toEqual(['context', 'model']);
  });
  it('filters by phase and passes through "all"', () => {
    expect(filterByPhase(steps, 'context')).toHaveLength(2);
    expect(filterByPhase(steps, 'all')).toHaveLength(3);
  });
});

describe('formatValue', () => {
  it('returns strings as-is and stringifies objects', () => {
    expect(formatValue('x')).toBe('x');
    expect(formatValue({ a: 1 })).toContain('"a": 1');
    expect(formatValue(null)).toBe('');
  });
});
