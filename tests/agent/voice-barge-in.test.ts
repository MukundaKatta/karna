import { describe, it, expect, vi } from 'vitest';
import { BargeInController } from '../../agent/src/voice/barge-in.js';

describe('BargeInController', () => {
  it('starts in idle and provides no signal', () => {
    const c = new BargeInController();
    expect(c.getState()).toBe('idle');
    expect(c.signal).toBeNull();
  });

  it('transitions to playing and exposes an abort signal', () => {
    const c = new BargeInController();
    const onStart = vi.fn();
    c.on('playback-start', onStart);
    const signal = c.startPlayback(0);
    expect(c.getState()).toBe('playing');
    expect(signal.aborted).toBe(false);
    expect(c.signal).toBe(signal);
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('triggers barge-in after sustained speech and aborts TTS', () => {
    const c = new BargeInController({ minSpeechMs: 200 });
    const onBarge = vi.fn();
    c.on('barge-in', onBarge);
    const signal = c.startPlayback(0);

    // speech begins at t=0, but minSpeechMs not yet reached
    expect(c.onVadFrame(true, 0)).toBe(false);
    expect(c.onVadFrame(true, 100)).toBe(false);
    expect(signal.aborted).toBe(false);

    // reaches threshold at t=200
    expect(c.onVadFrame(true, 200)).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(c.getState()).toBe('listening');
    expect(onBarge).toHaveBeenCalledWith({ atMs: 200, speechMs: 200 });
  });

  it('resets speech timer when silence interrupts speech', () => {
    const c = new BargeInController({ minSpeechMs: 200 });
    c.startPlayback(0);
    expect(c.onVadFrame(true, 0)).toBe(false);
    expect(c.onVadFrame(false, 100)).toBe(false); // silence resets timer
    expect(c.onVadFrame(true, 150)).toBe(false); // timer restarted at 150
    expect(c.onVadFrame(true, 300)).toBe(false); // only 150ms elapsed
    expect(c.onVadFrame(true, 350)).toBe(true); // 200ms reached
  });

  it('ignores speech during the start grace period', () => {
    const c = new BargeInController({ minSpeechMs: 0, startGraceMs: 300 });
    const signal = c.startPlayback(0);
    expect(c.onVadFrame(true, 100)).toBe(false);
    expect(c.onVadFrame(true, 299)).toBe(false);
    expect(signal.aborted).toBe(false);
    expect(c.onVadFrame(true, 300)).toBe(true);
  });

  it('does not barge in when disabled', () => {
    const c = new BargeInController({ enabled: false, minSpeechMs: 0 });
    const signal = c.startPlayback(0);
    expect(c.onVadFrame(true, 100)).toBe(false);
    expect(signal.aborted).toBe(false);
    expect(c.getState()).toBe('playing');
  });

  it('finishes playback naturally to idle', () => {
    const c = new BargeInController();
    const onEnd = vi.fn();
    c.on('playback-end', onEnd);
    c.startPlayback(0);
    c.finishPlayback();
    expect(c.getState()).toBe('idle');
    expect(c.signal).toBeNull();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('emits transition events', () => {
    const c = new BargeInController({ minSpeechMs: 0 });
    const transitions: string[] = [];
    c.on('transition', (from, to) => transitions.push(`${from}->${to}`));
    c.startPlayback(0);
    c.onVadFrame(true, 0);
    expect(transitions).toEqual(['idle->playing', 'playing->interrupting', 'interrupting->listening']);
  });

  it('reset aborts in-flight playback', () => {
    const c = new BargeInController();
    const signal = c.startPlayback(0);
    c.reset();
    expect(signal.aborted).toBe(true);
    expect(c.getState()).toBe('idle');
  });
});
