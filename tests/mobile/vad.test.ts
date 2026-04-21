import {
  MOBILE_VAD_SILENCE_DURATION_MS,
  MOBILE_VAD_SILENCE_THRESHOLD,
  normalizeMeteringLevel,
  shouldAutoStopRecording,
} from "../../apps/mobile/lib/vad.js";

describe("mobile voice VAD helpers", () => {
  it("normalizes metering values into a 0..1 range", () => {
    expect(normalizeMeteringLevel(-60)).toBe(0);
    expect(normalizeMeteringLevel(-30)).toBe(0.5);
    expect(normalizeMeteringLevel(0)).toBe(1);
    expect(normalizeMeteringLevel(12)).toBe(1);
  });

  it("starts a silence window when levels drop below the threshold", () => {
    const result = shouldAutoStopRecording({
      normalizedLevel: MOBILE_VAD_SILENCE_THRESHOLD - 0.01,
      silenceStartedAt: null,
      now: 1_000,
    });

    expect(result).toEqual({
      nextSilenceStartedAt: 1_000,
      shouldStop: false,
    });
  });

  it("clears the silence window when speech resumes", () => {
    const result = shouldAutoStopRecording({
      normalizedLevel: MOBILE_VAD_SILENCE_THRESHOLD + 0.2,
      silenceStartedAt: 1_000,
      now: 1_500,
    });

    expect(result).toEqual({
      nextSilenceStartedAt: null,
      shouldStop: false,
    });
  });

  it("stops once silence lasts longer than the configured duration", () => {
    const result = shouldAutoStopRecording({
      normalizedLevel: MOBILE_VAD_SILENCE_THRESHOLD - 0.02,
      silenceStartedAt: 2_000,
      now: 2_000 + MOBILE_VAD_SILENCE_DURATION_MS,
    });

    expect(result).toEqual({
      nextSilenceStartedAt: 2_000,
      shouldStop: true,
    });
  });
});
