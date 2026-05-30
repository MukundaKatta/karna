import { describe, it, expect, vi } from 'vitest';
import {
  BoundedQueue,
  QueueFullError,
  RateLimitedQueue,
  TokenBucket,
} from '../../channels/_shared/rate-limit.js';

describe('TokenBucket (#607)', () => {
  it('starts full and drains on tryRemove', () => {
    const b = new TokenBucket({ capacity: 3, refillPerSecond: 1, now: () => 0 });
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(false);
  });

  it('refills over time using injected clock', () => {
    let t = 0;
    const b = new TokenBucket({
      capacity: 2,
      refillPerSecond: 2,
      now: () => t,
      initialTokens: 0,
    });
    expect(b.tryRemove()).toBe(false);
    t = 1000; // +1s => +2 tokens
    expect(b.available()).toBeCloseTo(2, 5);
    expect(b.tryRemove()).toBe(true);
  });

  it('never exceeds capacity when refilling', () => {
    let t = 0;
    const b = new TokenBucket({
      capacity: 5,
      refillPerSecond: 100,
      now: () => t,
      initialTokens: 5,
    });
    t = 10_000;
    expect(b.available()).toBe(5);
  });

  it('computes msUntilAvailable for a deficit', () => {
    const b = new TokenBucket({
      capacity: 10,
      refillPerSecond: 2,
      now: () => 0,
      initialTokens: 0,
    });
    // need 1 token at 2/sec => 500ms
    expect(b.msUntilAvailable(1)).toBe(500);
  });

  it('removeToken resolves once tokens become available', async () => {
    vi.useFakeTimers();
    try {
      let t = 0;
      const b = new TokenBucket({
        capacity: 1,
        refillPerSecond: 1,
        now: () => t,
        initialTokens: 0,
      });
      const p = b.removeToken(1);
      // advance virtual clock + timers so the internal sleep resolves
      t = 1000;
      await vi.advanceTimersByTimeAsync(1000);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when removing more than capacity', async () => {
    const b = new TokenBucket({ capacity: 2, refillPerSecond: 1 });
    await expect(b.removeToken(3)).rejects.toThrow(/capacity/);
  });
});

describe('BoundedQueue (#607)', () => {
  it('processes items FIFO through the worker', async () => {
    const seen: number[] = [];
    const q = new BoundedQueue<number>({
      maxDepth: 10,
      worker: (n) => {
        seen.push(n);
      },
    });
    await Promise.all([q.enqueue(1), q.enqueue(2), q.enqueue(3)]);
    expect(seen).toEqual([1, 2, 3]);
    expect(q.getMetrics().processed).toBe(3);
  });

  it('rejects when full under the default reject policy', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = new BoundedQueue<number>({
      maxDepth: 1,
      worker: async () => {
        await gate; // hold the worker so the queue fills
      },
    });
    // first enters worker (buffer empties), then fill the 1 slot
    const p1 = q.enqueue(1);
    const p2 = q.enqueue(2); // occupies the single buffer slot
    await expect(q.enqueue(3)).rejects.toBeInstanceOf(QueueFullError);
    release();
    await Promise.all([p1, p2]);
  });

  it('drop-oldest evicts the oldest waiting item', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const processed: number[] = [];
    const q = new BoundedQueue<number>({
      maxDepth: 1,
      overflow: 'drop-oldest',
      worker: async (n) => {
        await gate;
        processed.push(n);
      },
    });
    const p1 = q.enqueue(1); // goes into worker
    const p2 = q.enqueue(2); // sits in buffer (slot 1)
    const p3 = q.enqueue(3); // evicts item 2
    await expect(p2).rejects.toBeInstanceOf(QueueFullError);
    release();
    await Promise.allSettled([p1, p3]);
    expect(q.getMetrics().dropped).toBe(1);
    expect(processed).toContain(3);
    expect(processed).not.toContain(2);
  });

  it('propagates worker errors to the enqueue promise', async () => {
    const q = new BoundedQueue<number>({
      maxDepth: 5,
      worker: () => {
        throw new Error('boom');
      },
    });
    await expect(q.enqueue(1)).rejects.toThrow('boom');
  });

  it('tracks high-water mark and metrics', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = new BoundedQueue<number>({
      maxDepth: 5,
      worker: async () => {
        await gate;
      },
    });
    const ps = [q.enqueue(1), q.enqueue(2), q.enqueue(3)];
    expect(q.getMetrics().highWaterMark).toBeGreaterThanOrEqual(2);
    release();
    await Promise.all(ps);
    expect(q.getMetrics().enqueued).toBe(3);
  });
});

describe('RateLimitedQueue (#607)', () => {
  it('sends items respecting the token bucket and backpressure', async () => {
    const sent: number[] = [];
    const rlq = new RateLimitedQueue<number>({
      bucket: { capacity: 10, refillPerSecond: 1000 },
      maxDepth: 10,
      send: (n) => {
        sent.push(n);
      },
    });
    await Promise.all([rlq.send(1), rlq.send(2), rlq.send(3)]);
    expect(sent).toEqual([1, 2, 3]);
    expect(rlq.getMetrics().processed).toBe(3);
  });
});
