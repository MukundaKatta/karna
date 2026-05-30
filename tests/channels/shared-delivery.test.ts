import { describe, it, expect, vi } from 'vitest';
import {
  computeBackoff,
  DeadLetterQueue,
  DeliveryPipeline,
  RetriesExhaustedError,
  withRetry,
} from '../../channels/_shared/delivery.js';

const noSleep = (_ms: number) => Promise.resolve();

describe('computeBackoff (#609)', () => {
  it('grows exponentially from the base delay', () => {
    const opts = { maxAttempts: 5, baseDelayMs: 100, factor: 2 };
    expect(computeBackoff(0, opts)).toBe(100);
    expect(computeBackoff(1, opts)).toBe(200);
    expect(computeBackoff(2, opts)).toBe(400);
  });

  it('caps at maxDelayMs', () => {
    const opts = { maxAttempts: 5, baseDelayMs: 100, factor: 10, maxDelayMs: 500 };
    expect(computeBackoff(3, opts)).toBe(500);
  });

  it('applies bounded jitter using injected rng', () => {
    const opts = {
      maxAttempts: 5,
      baseDelayMs: 100,
      factor: 1,
      jitter: 0.5,
      random: () => 1, // max positive jitter
    };
    expect(computeBackoff(0, opts)).toBe(150);
  });
});

describe('withRetry (#609)', () => {
  it('returns on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const out = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValue('done');
    const onRetry = vi.fn();
    const out = await withRetry(fn, {
      maxAttempts: 5,
      baseDelayMs: 1,
      sleep: noSleep,
      onRetry,
    });
    expect(out).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('throws RetriesExhaustedError after exhausting attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'));
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep }),
    ).rejects.toBeInstanceOf(RetriesExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal'));
    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        baseDelayMs: 1,
        sleep: noSleep,
        isRetryable: () => false,
      }),
    ).rejects.toBeInstanceOf(RetriesExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('DeadLetterQueue (#609)', () => {
  it('adds and inspects entries', () => {
    const dlq = new DeadLetterQueue<string>({ idFactory: () => 'id1', now: () => 123 });
    const entry = dlq.add('payload', 3, new Error('nope'));
    expect(entry.id).toBe('id1');
    expect(entry.attempts).toBe(3);
    expect(entry.error).toBe('nope');
    expect(entry.timestamp).toBe(123);
    expect(dlq.inspect()).toHaveLength(1);
  });

  it('evicts oldest beyond maxSize', () => {
    let n = 0;
    const dlq = new DeadLetterQueue<number>({ maxSize: 2, idFactory: () => `id${++n}` });
    dlq.add(1, 1, 'e');
    dlq.add(2, 1, 'e');
    dlq.add(3, 1, 'e');
    expect(dlq.size()).toBe(2);
    expect(dlq.inspect().map((e) => e.payload)).toEqual([2, 3]);
  });

  it('peeks and removes by id', () => {
    let n = 0;
    const dlq = new DeadLetterQueue<number>({ idFactory: () => `id${++n}` });
    dlq.add(10, 1, 'e');
    expect(dlq.peek('id1')?.payload).toBe(10);
    expect(dlq.remove('id1')?.payload).toBe(10);
    expect(dlq.size()).toBe(0);
    expect(dlq.remove('id1')).toBeUndefined();
  });

  it('replays a single entry on success and removes it', async () => {
    let n = 0;
    const dlq = new DeadLetterQueue<string>({ idFactory: () => `id${++n}` });
    dlq.add('msg', 2, 'err');
    const send = vi.fn().mockResolvedValue(undefined);
    const ok = await dlq.replay('id1', send);
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith('msg');
    expect(dlq.size()).toBe(0);
  });

  it('keeps the entry and updates error when replay fails', async () => {
    let n = 0;
    const dlq = new DeadLetterQueue<string>({ idFactory: () => `id${++n}`, now: () => 999 });
    dlq.add('msg', 2, 'old');
    const send = vi.fn().mockRejectedValue(new Error('still failing'));
    const ok = await dlq.replay('id1', send);
    expect(ok).toBe(false);
    expect(dlq.size()).toBe(1);
    const e = dlq.peek('id1')!;
    expect(e.error).toBe('still failing');
    expect(e.attempts).toBe(3);
  });

  it('replayAll reports successes and failures', async () => {
    let n = 0;
    const dlq = new DeadLetterQueue<number>({ idFactory: () => `id${++n}` });
    dlq.add(1, 1, 'e');
    dlq.add(2, 1, 'e');
    const send = vi
      .fn()
      .mockResolvedValueOnce(undefined) // 1 succeeds
      .mockRejectedValueOnce(new Error('x')); // 2 fails
    const res = await dlq.replayAll(send);
    expect(res).toEqual({ succeeded: 1, failed: 1 });
    expect(dlq.size()).toBe(1);
  });

  it('drain empties the queue', () => {
    const dlq = new DeadLetterQueue<number>();
    dlq.add(1, 1, 'e');
    dlq.add(2, 1, 'e');
    const drained = dlq.drain();
    expect(drained).toHaveLength(2);
    expect(dlq.size()).toBe(0);
  });
});

describe('DeliveryPipeline (#609)', () => {
  it('delivers successfully without dead-lettering', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const pipe = new DeliveryPipeline<string>({
      send,
      retry: { maxAttempts: 3, baseDelayMs: 1, sleep: noSleep },
    });
    const ok = await pipe.deliver('hi');
    expect(ok).toBe(true);
    expect(pipe.dlq.size()).toBe(0);
  });

  it('dead-letters after exhausting retries', async () => {
    const send = vi.fn().mockRejectedValue(new Error('down'));
    const pipe = new DeliveryPipeline<string>({
      send,
      retry: { maxAttempts: 2, baseDelayMs: 1, sleep: noSleep },
    });
    const ok = await pipe.deliver('hi');
    expect(ok).toBe(false);
    expect(pipe.dlq.size()).toBe(1);
    const entry = pipe.dlq.inspect()[0];
    expect(entry.attempts).toBe(2);
    expect(entry.error).toBe('down');
    expect(entry.payload).toBe('hi');
  });

  it('a dead-lettered message can later be replayed', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(undefined);
    const pipe = new DeliveryPipeline<string>({
      send,
      retry: { maxAttempts: 2, baseDelayMs: 1, sleep: noSleep },
    });
    await pipe.deliver('hi');
    expect(pipe.dlq.size()).toBe(1);
    const id = pipe.dlq.inspect()[0].id;
    const replayed = await pipe.dlq.replay(id, send);
    expect(replayed).toBe(true);
    expect(pipe.dlq.size()).toBe(0);
  });
});
