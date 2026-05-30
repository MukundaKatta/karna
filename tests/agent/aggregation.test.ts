import { describe, it, expect, vi } from 'vitest';
import {
  ConcatReducer,
  MajorityVoteReducer,
  FirstSuccessReducer,
  LlmSummarizeReducer,
  createReducer,
  aggregate,
  type SubAgentResult,
} from '../../agent/src/orchestration/aggregation.js';

const results: SubAgentResult[] = [
  { taskId: 't1', output: 'apple', success: true },
  { taskId: 't2', output: 'apple', success: true },
  { taskId: 't3', output: 'banana', success: true },
  { taskId: 't4', output: 'failed', success: false, error: 'boom' },
];

describe('ConcatReducer', () => {
  it('concatenates successful outputs', () => {
    const r = new ConcatReducer(' | ').reduce(results);
    expect(r.output).toBe('apple | apple | banana');
    expect(r.contributingTaskIds).toEqual(['t1', 't2', 't3']);
    expect(r.successCount).toBe(3);
    expect(r.failureCount).toBe(1);
    expect(r.strategy).toBe('concat');
  });
});

describe('MajorityVoteReducer', () => {
  it('picks the most common output', () => {
    const r = new MajorityVoteReducer().reduce(results);
    expect(r.output).toBe('apple');
    expect(r.contributingTaskIds).toEqual(['t1', 't2']);
    expect(r.metadata?.votes).toBe(2);
    expect(r.metadata?.distinctOutputs).toBe(2);
  });

  it('breaks ties by first occurrence', () => {
    const tie: SubAgentResult[] = [
      { taskId: 'a', output: 'x', success: true },
      { taskId: 'b', output: 'y', success: true },
    ];
    expect(new MajorityVoteReducer().reduce(tie).output).toBe('x');
  });

  it('is case-insensitive by default', () => {
    const data: SubAgentResult[] = [
      { taskId: 'a', output: 'Yes', success: true },
      { taskId: 'b', output: 'yes', success: true },
      { taskId: 'c', output: 'no', success: true },
    ];
    const r = new MajorityVoteReducer().reduce(data);
    expect(r.metadata?.votes).toBe(2);
  });

  it('respects case sensitivity when configured', () => {
    const data: SubAgentResult[] = [
      { taskId: 'a', output: 'Yes', success: true },
      { taskId: 'b', output: 'yes', success: true },
    ];
    const r = new MajorityVoteReducer(true).reduce(data);
    expect(r.metadata?.distinctOutputs).toBe(2);
  });
});

describe('FirstSuccessReducer', () => {
  it('returns the first successful output', () => {
    const r = new FirstSuccessReducer().reduce(results);
    expect(r.output).toBe('apple');
    expect(r.contributingTaskIds).toEqual(['t1']);
  });

  it('returns empty when nothing succeeded', () => {
    const r = new FirstSuccessReducer().reduce([
      { taskId: 'x', output: '', success: false },
    ]);
    expect(r.output).toBe('');
    expect(r.contributingTaskIds).toEqual([]);
  });
});

describe('LlmSummarizeReducer', () => {
  it('invokes injected summarizer with successful outputs', async () => {
    const summarizer = vi.fn(async (inputs: string[]) => `summary of ${inputs.length}`);
    const r = await new LlmSummarizeReducer(summarizer).reduce(results);
    expect(summarizer).toHaveBeenCalledWith(['apple', 'apple', 'banana']);
    expect(r.output).toBe('summary of 3');
    expect(r.successCount).toBe(3);
  });

  it('skips summarizer when no successful inputs', async () => {
    const summarizer = vi.fn(async () => 'never');
    const r = await new LlmSummarizeReducer(summarizer).reduce([
      { taskId: 'x', output: '', success: false },
    ]);
    expect(summarizer).not.toHaveBeenCalled();
    expect(r.output).toBe('');
  });
});

describe('createReducer / aggregate', () => {
  it('builds reducers by strategy', () => {
    expect(createReducer({ strategy: 'concat' }).strategy).toBe('concat');
    expect(createReducer({ strategy: 'majority-vote' }).strategy).toBe('majority-vote');
    expect(createReducer({ strategy: 'first-success' }).strategy).toBe('first-success');
  });

  it('throws when llm-summarize lacks a summarizer', () => {
    expect(() => createReducer({ strategy: 'llm-summarize' })).toThrow(/summarizer/);
  });

  it('defaults to concat', async () => {
    const r = await aggregate(results);
    expect(r.strategy).toBe('concat');
  });

  it('aggregate works with llm-summarize and injected fn', async () => {
    const r = await aggregate(results, {
      strategy: 'llm-summarize',
      summarizer: (inputs) => inputs.join(','),
    });
    expect(r.output).toBe('apple,apple,banana');
  });
});
