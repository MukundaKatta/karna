import { describe, it, expect } from 'vitest';
import {
  runParallelSubAgents,
  runAndAggregate,
  toSubAgentResult,
  SubAgentAbortError,
  type SubAgentTask,
} from '../../agent/src/orchestration/parallel-subagents.js';

function tasks(ids: string[]): SubAgentTask<number>[] {
  return ids.map((id, i) => ({ id, input: i }));
}

describe('runParallelSubAgents', () => {
  it('runs all tasks and captures successes', async () => {
    const res = await runParallelSubAgents(
      tasks(['a', 'b', 'c']),
      async (t) => `out-${t.id}`,
      { concurrency: 2 },
    );
    expect(res.allSucceeded).toBe(true);
    expect(res.successCount).toBe(3);
    expect(res.results.map((r) => r.output)).toEqual(['out-a', 'out-b', 'out-c']);
  });

  it('captures per-task errors without rejecting', async () => {
    const res = await runParallelSubAgents(
      tasks(['ok', 'bad']),
      async (t) => {
        if (t.id === 'bad') throw new Error('kaboom');
        return 'fine';
      },
    );
    expect(res.failureCount).toBe(1);
    expect(res.successCount).toBe(1);
    const bad = res.results.find((r) => r.taskId === 'bad');
    expect(bad?.success).toBe(false);
    expect(bad?.error).toBe('kaboom');
  });

  it('respects concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const res = await runParallelSubAgents(
      tasks(['a', 'b', 'c', 'd', 'e']),
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return 'x';
      },
      { concurrency: 2 },
    );
    expect(res.successCount).toBe(5);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('cancels pending tasks when the external signal aborts', async () => {
    const controller = new AbortController();
    const res = await runParallelSubAgents(
      tasks(['a', 'b', 'c', 'd']),
      async (t) => {
        if (t.id === 'a') controller.abort();
        await new Promise((r) => setTimeout(r, 2));
        return 'done';
      },
      { concurrency: 1, signal: controller.signal },
    );
    expect(res.cancelledCount).toBeGreaterThan(0);
    // Some later tasks should be marked cancelled-before-start.
    const cancelled = res.results.filter((r) => r.cancelled);
    expect(cancelled.length).toBeGreaterThan(0);
  });

  it('fail-fast aborts remaining tasks on first failure', async () => {
    const res = await runParallelSubAgents(
      tasks(['fail', 'b', 'c', 'd']),
      async (t) => {
        if (t.id === 'fail') throw new Error('stop');
        await new Promise((r) => setTimeout(r, 2));
        return 'ok';
      },
      { concurrency: 1, failFast: true },
    );
    expect(res.failureCount).toBeGreaterThanOrEqual(1);
    expect(res.results.some((r) => r.cancelled)).toBe(true);
  });

  it('uses an injected clock for durations', async () => {
    let t = 0;
    const res = await runParallelSubAgents(
      tasks(['a']),
      async () => 'x',
      { now: () => (t += 10) },
    );
    expect(res.results[0].durationMs).toBe(10);
  });
});

describe('toSubAgentResult + runAndAggregate', () => {
  it('maps a task result to a SubAgentResult shape', () => {
    const mapped = toSubAgentResult({
      taskId: 't1',
      success: false,
      error: 'oops',
      cancelled: false,
      durationMs: 1,
    });
    expect(mapped).toEqual({ taskId: 't1', output: '', success: false, error: 'oops' });
  });

  it('runs and aggregates with the concat reducer', async () => {
    const { run, aggregated } = await runAndAggregate(
      tasks(['a', 'b']),
      async (t) => `r-${t.id}`,
      { concurrency: 2 },
      { strategy: 'concat', separator: ' | ' },
    );
    expect(run.allSucceeded).toBe(true);
    expect(aggregated.output).toBe('r-a | r-b');
    expect(aggregated.successCount).toBe(2);
  });
});

describe('SubAgentAbortError', () => {
  it('has the right name', () => {
    expect(new SubAgentAbortError().name).toBe('SubAgentAbortError');
  });
});
