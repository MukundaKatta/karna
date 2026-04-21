export const MOBILE_VAD_SILENCE_THRESHOLD = 0.08;
export const MOBILE_VAD_SILENCE_DURATION_MS = 1400;

export function normalizeMeteringLevel(metering: number): number {
  return Math.max(0, Math.min(1, (metering + 60) / 60));
}

export function shouldAutoStopRecording(params: {
  normalizedLevel: number;
  silenceThreshold?: number;
  silenceDurationMs?: number;
  silenceStartedAt: number | null;
  now: number;
}): {
  nextSilenceStartedAt: number | null;
  shouldStop: boolean;
} {
  const silenceThreshold =
    params.silenceThreshold ?? MOBILE_VAD_SILENCE_THRESHOLD;
  const silenceDurationMs =
    params.silenceDurationMs ?? MOBILE_VAD_SILENCE_DURATION_MS;

  if (params.normalizedLevel > silenceThreshold) {
    return {
      nextSilenceStartedAt: null,
      shouldStop: false,
    };
  }

  if (params.silenceStartedAt === null) {
    return {
      nextSilenceStartedAt: params.now,
      shouldStop: false,
    };
  }

  return {
    nextSilenceStartedAt: params.silenceStartedAt,
    shouldStop: params.now - params.silenceStartedAt >= silenceDurationMs,
  };
}
