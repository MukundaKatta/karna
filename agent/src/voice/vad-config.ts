import { z } from 'zod';

/**
 * Issue #605 — Voice activity detection tuning.
 *
 * Configurable VAD thresholds and endpointing logic implemented as pure
 * functions over frame energy samples. Additive: this does not modify the
 * existing {@link EnergyVAD} in `vad.ts`; it provides a richer, fully
 * deterministic endpointer that the pipeline can opt into.
 */

export const VadTuningConfigSchema = z.object({
  /** Energy above this (relative, 0..1) counts as speech. */
  energyThreshold: z.number().min(0).max(1).default(0.01),
  /** Each frame's duration in ms (used to convert frame counts to time). */
  frameMs: z.number().int().min(1).default(20),
  /**
   * Continuous speech (ms) required to declare speech START. Debounces noise.
   */
  speechOnsetMs: z.number().int().min(0).default(120),
  /**
   * Continuous silence (ms) after speech required to declare endpoint
   * (utterance complete). This is the core endpointing/silence parameter.
   */
  silenceDurationMs: z.number().int().min(0).default(700),
  /**
   * Optional hangover: keep treating frames just below threshold as speech for
   * this many ms after the last clear speech frame, to avoid clipping soft tails.
   */
  hangoverMs: z.number().int().min(0).default(0),
});

export type VadTuningConfig = z.infer<typeof VadTuningConfigSchema>;

export function resolveVadConfig(config?: Partial<VadTuningConfig>): VadTuningConfig {
  return VadTuningConfigSchema.parse(config ?? {});
}

/** Classify a single frame energy sample against the threshold. */
export function isSpeechFrame(energy: number, config: VadTuningConfig): boolean {
  return energy >= config.energyThreshold;
}

/**
 * Compute RMS energy (0..1-ish) of a PCM16 frame. Returned as a normalized
 * fraction of full scale. Pure helper for callers that have raw samples.
 */
export function frameEnergyPcm16(samples: Int16Array | number[]): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] / 32768;
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples.length);
}

export type EndpointEventType = 'speech-start' | 'speech-end' | 'none';

export interface EndpointResult {
  event: EndpointEventType;
  /** Whether the endpointer currently considers itself inside speech. */
  inSpeech: boolean;
  /** Trailing silence accumulated (ms) while in speech, else 0. */
  trailingSilenceMs: number;
}

/**
 * Stateful endpointer driven one frame at a time. Pure with respect to inputs:
 * given the same config and frame sequence it produces the same events. It does
 * not depend on wall-clock time — it advances by `frameMs` per frame.
 */
export class Endpointer {
  private config: VadTuningConfig;
  private inSpeech = false;
  private contiguousSpeechMs = 0;
  private contiguousSilenceMs = 0;
  private hangoverRemainingMs = 0;

  constructor(config?: Partial<VadTuningConfig>) {
    this.config = resolveVadConfig(config);
  }

  reset(): void {
    this.inSpeech = false;
    this.contiguousSpeechMs = 0;
    this.contiguousSilenceMs = 0;
    this.hangoverRemainingMs = 0;
  }

  get isInSpeech(): boolean {
    return this.inSpeech;
  }

  /** Process one frame's energy; returns the endpoint event (if any). */
  process(energy: number): EndpointResult {
    const { frameMs, speechOnsetMs, silenceDurationMs, hangoverMs } = this.config;
    let speech = isSpeechFrame(energy, this.config);

    // Apply hangover: soft frames within the hangover window still count as speech.
    if (!speech && this.hangoverRemainingMs > 0) {
      speech = true;
      this.hangoverRemainingMs = Math.max(0, this.hangoverRemainingMs - frameMs);
    } else if (speech) {
      this.hangoverRemainingMs = hangoverMs;
    }

    let event: EndpointEventType = 'none';

    if (!this.inSpeech) {
      if (speech) {
        this.contiguousSpeechMs += frameMs;
        if (this.contiguousSpeechMs >= speechOnsetMs) {
          this.inSpeech = true;
          this.contiguousSilenceMs = 0;
          event = 'speech-start';
        }
      } else {
        this.contiguousSpeechMs = 0;
      }
    } else {
      if (speech) {
        this.contiguousSilenceMs = 0;
      } else {
        this.contiguousSilenceMs += frameMs;
        if (this.contiguousSilenceMs >= silenceDurationMs) {
          this.inSpeech = false;
          this.contiguousSpeechMs = 0;
          this.hangoverRemainingMs = 0;
          event = 'speech-end';
        }
      }
    }

    return {
      event,
      inSpeech: this.inSpeech,
      trailingSilenceMs: this.inSpeech ? this.contiguousSilenceMs : 0,
    };
  }
}

/**
 * Convenience: run an endpointer over a full sequence of frame energies and
 * return the indices at which speech-start / speech-end events occurred.
 */
export function detectEndpoints(
  energies: number[],
  config?: Partial<VadTuningConfig>,
): Array<{ frame: number; event: EndpointEventType }> {
  const ep = new Endpointer(config);
  const events: Array<{ frame: number; event: EndpointEventType }> = [];
  energies.forEach((e, i) => {
    const r = ep.process(e);
    if (r.event !== 'none') events.push({ frame: i, event: r.event });
  });
  return events;
}
