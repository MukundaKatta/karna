import { z } from 'zod';
import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';

/**
 * Issue #604 — Barge-in / interruption handling.
 *
 * A pure, testable state machine that detects user speech during TTS playback
 * and preempts the current turn: it cancels the active TTS via an
 * {@link AbortController} and transitions the conversation so the agent listens
 * to the interrupting user.
 *
 * Additive: nothing here is wired into the existing pipeline. The runtime can
 * adopt it by feeding VAD speech/silence events and reacting to emitted events.
 */

export const BargeInConfigSchema = z.object({
  /**
   * Minimum continuous speech duration (ms) during playback before a barge-in
   * is triggered. Guards against transient noise / brief backchannels.
   */
  minSpeechMs: z.number().int().min(0).default(200),
  /**
   * Grace period (ms) at the very start of playback during which speech does
   * NOT trigger a barge-in (e.g. the user's own trailing audio). 0 = disabled.
   */
  startGraceMs: z.number().int().min(0).default(0),
  /** Whether barge-in is enabled at all. */
  enabled: z.boolean().default(true),
});

export type BargeInConfig = z.infer<typeof BargeInConfigSchema>;

export type BargeInState = 'idle' | 'playing' | 'interrupting' | 'listening';

export interface BargeInEvents {
  /** Playback started; carries the AbortSignal that TTS should observe. */
  'playback-start': (signal: AbortSignal) => void;
  /** A barge-in was triggered; the active TTS abort controller has been aborted. */
  'barge-in': (info: { atMs: number; speechMs: number }) => void;
  /** Playback completed naturally without interruption. */
  'playback-end': () => void;
  /** State transition occurred. */
  transition: (from: BargeInState, to: BargeInState) => void;
}

/**
 * Pure state machine driving barge-in. Time is injected via the `nowMs`
 * argument on each call so it is fully deterministic and testable; callers can
 * pass `Date.now()` in production.
 */
export class BargeInController extends EventEmitter {
  private config: BargeInConfig;
  private logger?: Logger;
  private state: BargeInState = 'idle';
  private controller: AbortController | null = null;
  private playbackStartedAt = 0;
  private speechStartedAt: number | null = null;

  constructor(config?: Partial<BargeInConfig>, logger?: Logger) {
    super();
    this.config = BargeInConfigSchema.parse(config ?? {});
    this.logger = logger;
  }

  getState(): BargeInState {
    return this.state;
  }

  /** The signal for the current playback, if any; TTS should abort on it. */
  get signal(): AbortSignal | null {
    return this.controller?.signal ?? null;
  }

  private setState(next: BargeInState): void {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    this.emit('transition', prev, next);
  }

  /** Begin TTS playback. Returns the AbortSignal TTS must observe. */
  startPlayback(nowMs = Date.now()): AbortSignal {
    this.controller = new AbortController();
    this.playbackStartedAt = nowMs;
    this.speechStartedAt = null;
    this.setState('playing');
    this.emit('playback-start', this.controller.signal);
    this.logger?.debug({ nowMs }, 'barge-in: playback start');
    return this.controller.signal;
  }

  /**
   * Feed a VAD frame. `speech` indicates whether the frame contains user speech.
   * Returns true if this frame triggered a barge-in.
   */
  onVadFrame(speech: boolean, nowMs = Date.now()): boolean {
    if (this.state !== 'playing' || !this.config.enabled) {
      this.speechStartedAt = null;
      return false;
    }
    if (!speech) {
      this.speechStartedAt = null;
      return false;
    }
    // Within the start grace period, ignore speech entirely.
    if (this.config.startGraceMs > 0 && nowMs - this.playbackStartedAt < this.config.startGraceMs) {
      return false;
    }
    if (this.speechStartedAt === null) {
      this.speechStartedAt = nowMs;
    }
    const speechMs = nowMs - this.speechStartedAt;
    if (speechMs >= this.config.minSpeechMs) {
      this.triggerBargeIn(nowMs, speechMs);
      return true;
    }
    return false;
  }

  private triggerBargeIn(nowMs: number, speechMs: number): void {
    this.setState('interrupting');
    this.controller?.abort();
    this.logger?.info({ nowMs, speechMs }, 'barge-in: triggered, TTS aborted');
    this.emit('barge-in', { atMs: nowMs, speechMs });
    this.speechStartedAt = null;
    // After preempting, the agent should be listening to the interrupting user.
    this.setState('listening');
  }

  /** Playback finished naturally (no interruption). */
  finishPlayback(): void {
    if (this.state !== 'playing') return;
    this.controller = null;
    this.speechStartedAt = null;
    this.setState('idle');
    this.emit('playback-end');
  }

  /** Reset to idle, aborting any in-flight playback. */
  reset(): void {
    if (this.controller && !this.controller.signal.aborted) {
      this.controller.abort();
    }
    this.controller = null;
    this.speechStartedAt = null;
    this.setState('idle');
  }
}
