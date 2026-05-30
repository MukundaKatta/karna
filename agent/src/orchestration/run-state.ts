import { z } from 'zod';
import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';

/**
 * Issue #530 — Agent run state machine.
 *
 * An explicit reason -> act -> observe state machine for a single agent run.
 * Transitions are validated against an allowed-transition table; every accepted
 * transition emits a serializable {@link RunEvent} (suitable for JSONL/transcript
 * persistence). Pure and deterministic — it tracks state and history only, never
 * executing model or tool calls.
 *
 * States:
 *   idle    -> reason            (start)
 *   reason  -> act | observe | done | failed
 *   act     -> observe | failed
 *   observe -> reason | done | failed
 *   done / failed                (terminal)
 */

export const RunStateSchema = z.enum(['idle', 'reason', 'act', 'observe', 'done', 'failed']);
export type RunState = z.infer<typeof RunStateSchema>;

/** Terminal states. */
export const TERMINAL_STATES: ReadonlySet<RunState> = new Set<RunState>(['done', 'failed']);

/** Allowed transitions: from -> set of valid next states. */
const TRANSITIONS: Record<RunState, ReadonlySet<RunState>> = {
  idle: new Set<RunState>(['reason']),
  reason: new Set<RunState>(['act', 'observe', 'done', 'failed']),
  act: new Set<RunState>(['observe', 'failed']),
  observe: new Set<RunState>(['reason', 'done', 'failed']),
  done: new Set<RunState>(),
  failed: new Set<RunState>(),
};

/** A serializable record of one accepted transition. */
export interface RunEvent {
  /** Monotonic sequence number within the run, starting at 0. */
  seq: number;
  from: RunState;
  to: RunState;
  /** Epoch milliseconds the transition was recorded. */
  at: number;
  /** Optional serializable payload (e.g. tool name, observation summary). */
  payload?: Record<string, unknown>;
}

/** Error thrown on an invalid transition. */
export class InvalidTransitionError extends Error {
  constructor(public readonly from: RunState, public readonly to: RunState) {
    super(`invalid run-state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export interface RunStateMachineOptions {
  /** Injected clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
  logger?: Logger;
}

/**
 * The run state machine. Emits a `transition` event (and `done`/`failed` on
 * reaching terminal states) for every accepted transition.
 */
export class RunStateMachine extends EventEmitter {
  private state: RunState = 'idle';
  private seq = 0;
  private readonly events: RunEvent[] = [];
  private readonly now: () => number;
  private readonly logger?: Logger;

  constructor(opts: RunStateMachineOptions = {}) {
    super();
    this.now = opts.now ?? Date.now;
    this.logger = opts.logger;
  }

  getState(): RunState {
    return this.state;
  }

  isTerminal(): boolean {
    return TERMINAL_STATES.has(this.state);
  }

  /** Allowed next states from the current state. */
  allowedNext(): RunState[] {
    return [...TRANSITIONS[this.state]];
  }

  canTransition(to: RunState): boolean {
    return TRANSITIONS[this.state].has(to);
  }

  /**
   * Attempt a transition. Throws {@link InvalidTransitionError} when not
   * allowed. Returns the emitted event on success.
   */
  transition(to: RunState, payload?: Record<string, unknown>): RunEvent {
    if (!this.canTransition(to)) {
      this.logger?.warn({ from: this.state, to }, 'rejected run-state transition');
      throw new InvalidTransitionError(this.state, to);
    }
    const event: RunEvent = {
      seq: this.seq++,
      from: this.state,
      to,
      at: this.now(),
      ...(payload ? { payload } : {}),
    };
    this.state = to;
    this.events.push(event);
    this.logger?.debug({ from: event.from, to: event.to, seq: event.seq }, 'run-state transition');
    this.emit('transition', event);
    if (to === 'done') this.emit('done', event);
    if (to === 'failed') this.emit('failed', event);
    return event;
  }

  // ─── Convenience verbs ──────────────────────────────────────────────────────

  start(payload?: Record<string, unknown>): RunEvent {
    return this.transition('reason', payload);
  }

  act(payload?: Record<string, unknown>): RunEvent {
    return this.transition('act', payload);
  }

  observe(payload?: Record<string, unknown>): RunEvent {
    return this.transition('observe', payload);
  }

  reason(payload?: Record<string, unknown>): RunEvent {
    return this.transition('reason', payload);
  }

  finish(payload?: Record<string, unknown>): RunEvent {
    return this.transition('done', payload);
  }

  fail(payload?: Record<string, unknown>): RunEvent {
    return this.transition('failed', payload);
  }

  /** Immutable copy of the recorded event history. */
  history(): RunEvent[] {
    return this.events.map((e) => ({ ...e }));
  }

  /** Serialize the full machine to a plain object (JSONL-friendly). */
  toJSON(): { state: RunState; events: RunEvent[] } {
    return { state: this.state, events: this.history() };
  }
}
