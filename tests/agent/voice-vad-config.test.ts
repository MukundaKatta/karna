import { describe, it, expect } from 'vitest';
import {
  Endpointer,
  detectEndpoints,
  isSpeechFrame,
  frameEnergyPcm16,
  resolveVadConfig,
} from '../../agent/src/voice/vad-config.js';

describe('vad-config helpers', () => {
  it('resolves defaults', () => {
    const cfg = resolveVadConfig();
    expect(cfg.energyThreshold).toBe(0.01);
    expect(cfg.silenceDurationMs).toBe(700);
    expect(cfg.frameMs).toBe(20);
  });

  it('classifies speech frames against threshold', () => {
    const cfg = resolveVadConfig({ energyThreshold: 0.05 });
    expect(isSpeechFrame(0.06, cfg)).toBe(true);
    expect(isSpeechFrame(0.05, cfg)).toBe(true);
    expect(isSpeechFrame(0.04, cfg)).toBe(false);
  });

  it('computes RMS energy of pcm16 samples', () => {
    expect(frameEnergyPcm16([])).toBe(0);
    expect(frameEnergyPcm16([0, 0, 0])).toBe(0);
    const full = frameEnergyPcm16([32768, 32768]); // clamp-ish full scale
    expect(full).toBeCloseTo(1, 5);
  });
});

describe('Endpointer', () => {
  it('detects speech-start after onset duration', () => {
    const ep = new Endpointer({ energyThreshold: 0.1, frameMs: 20, speechOnsetMs: 60 });
    expect(ep.process(0.5).event).toBe('none'); // 20ms
    expect(ep.process(0.5).event).toBe('none'); // 40ms
    const r = ep.process(0.5); // 60ms -> start
    expect(r.event).toBe('speech-start');
    expect(r.inSpeech).toBe(true);
  });

  it('requires contiguous frames for onset', () => {
    const ep = new Endpointer({ energyThreshold: 0.1, frameMs: 20, speechOnsetMs: 60 });
    ep.process(0.5);
    ep.process(0.0); // resets onset counter
    ep.process(0.5);
    ep.process(0.5);
    const r = ep.process(0.5); // now 60ms contiguous
    expect(r.event).toBe('speech-start');
  });

  it('detects speech-end after silence duration', () => {
    const ep = new Endpointer({
      energyThreshold: 0.1,
      frameMs: 100,
      speechOnsetMs: 0,
      silenceDurationMs: 300,
    });
    expect(ep.process(0.5).event).toBe('speech-start'); // onset 0 -> immediate
    expect(ep.process(0.0).event).toBe('none'); // 100ms silence
    expect(ep.process(0.0).event).toBe('none'); // 200ms silence
    const r = ep.process(0.0); // 300ms silence -> end
    expect(r.event).toBe('speech-end');
    expect(r.inSpeech).toBe(false);
  });

  it('resets trailing silence when speech resumes', () => {
    const ep = new Endpointer({
      energyThreshold: 0.1,
      frameMs: 100,
      speechOnsetMs: 0,
      silenceDurationMs: 300,
    });
    ep.process(0.5); // start
    ep.process(0.0); // 100ms silence
    const resumed = ep.process(0.5); // speech again
    expect(resumed.trailingSilenceMs).toBe(0);
    expect(ep.process(0.0).event).toBe('none'); // silence restarts
  });

  it('applies hangover to bridge soft tails', () => {
    const ep = new Endpointer({
      energyThreshold: 0.1,
      frameMs: 100,
      speechOnsetMs: 0,
      silenceDurationMs: 200,
      hangoverMs: 100,
    });
    ep.process(0.5); // start, sets hangover budget 100ms
    // first sub-threshold frame consumed by hangover -> counts as speech
    expect(ep.process(0.0).inSpeech).toBe(true);
    // hangover exhausted, real silence accumulation begins
    ep.process(0.0); // 100ms silence
    expect(ep.process(0.0).event).toBe('speech-end'); // 200ms silence
  });

  it('detectEndpoints reports event frame indices', () => {
    const energies = [0.5, 0.5, 0.0, 0.0, 0.0];
    const events = detectEndpoints(energies, {
      energyThreshold: 0.1,
      frameMs: 100,
      speechOnsetMs: 0,
      silenceDurationMs: 300,
    });
    expect(events).toEqual([
      { frame: 0, event: 'speech-start' },
      { frame: 4, event: 'speech-end' },
    ]);
  });

  it('reset clears state', () => {
    const ep = new Endpointer({ energyThreshold: 0.1, frameMs: 100, speechOnsetMs: 0 });
    ep.process(0.5);
    expect(ep.isInSpeech).toBe(true);
    ep.reset();
    expect(ep.isInSpeech).toBe(false);
  });
});
