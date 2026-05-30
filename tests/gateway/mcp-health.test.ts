import { describe, it, expect, vi } from 'vitest';
import {
  McpCircuitBreaker,
  ExponentialBackoff,
  McpHealthMonitor,
} from '../../gateway/src/mcp/health';

describe('McpCircuitBreaker (#553)', () => {
  it('opens after the failure threshold', () => {
    let now = 0;
    const cb = new McpCircuitBreaker({ failureThreshold: 2, cooldownMs: 1000, now: () => now });
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.canRequest()).toBe(false);
  });

  it('half-opens after cooldown and closes on success', () => {
    let now = 0;
    const cb = new McpCircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => now });
    cb.recordFailure();
    expect(cb.canRequest()).toBe(false);
    now = 1000;
    expect(cb.canRequest()).toBe(true);
    expect(cb.getState()).toBe('half-open');
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
  });

  it('re-opens if the half-open probe fails', () => {
    let now = 0;
    const cb = new McpCircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: () => now });
    cb.recordFailure();
    now = 1000;
    cb.canRequest();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });
});

describe('ExponentialBackoff (#553)', () => {
  it('grows exponentially and caps at maxMs', () => {
    const b = new ExponentialBackoff({ initialMs: 100, factor: 2, maxMs: 500 });
    expect(b.next()).toBe(100);
    expect(b.next()).toBe(200);
    expect(b.next()).toBe(400);
    expect(b.next()).toBe(500); // capped (would be 800)
    expect(b.next()).toBe(500);
  });

  it('resets the attempt counter', () => {
    const b = new ExponentialBackoff({ initialMs: 100, factor: 2 });
    b.next();
    b.next();
    expect(b.attempts).toBe(2);
    b.reset();
    expect(b.attempts).toBe(0);
    expect(b.next()).toBe(100);
  });

  it('applies bounded jitter deterministically with injected RNG', () => {
    const b = new ExponentialBackoff({ initialMs: 100, factor: 1, jitter: 0.5, random: () => 1 });
    // base=100, offset=(1*2-1)*50 = +50 => 150
    expect(b.next()).toBe(150);
  });
});

describe('McpHealthMonitor (#553)', () => {
  it('reports healthy when the probe succeeds', async () => {
    const onChange = vi.fn();
    const monitor = new McpHealthMonitor({
      probe: async () => true,
      reconnect: async () => {},
      onAvailabilityChange: onChange,
    });
    const available = await monitor.check();
    expect(available).toBe(true);
    expect(monitor.getStatus()).toBe('healthy');
    expect(monitor.isAvailable()).toBe(true);
    // started available; no transition emitted
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks unavailable on probe failure and recovers via reconnect', async () => {
    let now = 0;
    let probeOk = false;
    const reconnect = vi.fn(async () => {
      probeOk = true;
    });
    const onChange = vi.fn();
    const monitor = new McpHealthMonitor({
      probe: async () => probeOk,
      reconnect,
      onAvailabilityChange: onChange,
      breaker: new McpCircuitBreaker({ failureThreshold: 5, cooldownMs: 1000, now: () => now }),
    });

    const available = await monitor.check();
    // probe failed -> unhealthy -> reconnect sets probeOk true -> markHealthy
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(available).toBe(true);
    expect(monitor.getStatus()).toBe('healthy');
    // down then back up => at least one change event
    expect(onChange).toHaveBeenCalledWith(false);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('opens the circuit after repeated reconnect failures and stops reconnecting', async () => {
    let now = 0;
    const reconnect = vi.fn(async () => {
      throw new Error('still down');
    });
    const monitor = new McpHealthMonitor({
      probe: async () => false,
      reconnect,
      breaker: new McpCircuitBreaker({ failureThreshold: 2, cooldownMs: 10_000, now: () => now }),
    });

    await monitor.check(); // failure 1 (probe) ... breaker counts probe + reconnect failure
    await monitor.check();
    expect(monitor.getCircuitState()).toBe('open');
    expect(monitor.isAvailable()).toBe(false);

    const callsBefore = reconnect.mock.calls.length;
    await monitor.check(); // circuit open -> reconnect skipped
    expect(reconnect.mock.calls.length).toBe(callsBefore);
  });

  it('nextReconnectDelay returns null while the circuit is cooling down', async () => {
    let now = 0;
    const monitor = new McpHealthMonitor({
      probe: async () => false,
      reconnect: async () => {
        throw new Error('down');
      },
      breaker: new McpCircuitBreaker({ failureThreshold: 1, cooldownMs: 5000, now: () => now }),
      backoff: new ExponentialBackoff({ initialMs: 100, factor: 2 }),
    });
    await monitor.check();
    expect(monitor.getCircuitState()).toBe('open');
    expect(monitor.nextReconnectDelay()).toBeNull();
    now = 5000;
    expect(monitor.nextReconnectDelay()).toBe(100);
  });
});
