import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

vi.mock("expo-file-system", () => ({
  documentDirectory: "file:///tmp/",
  getInfoAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(async () => undefined),
}));

vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: {
    Light: "Light",
    Medium: "Medium",
    Heavy: "Heavy",
  },
  NotificationFeedbackType: {
    Success: "Success",
    Warning: "Warning",
    Error: "Error",
  },
  impactAsync: vi.fn(async () => undefined),
  notificationAsync: vi.fn(async () => undefined),
}));

describe("mobile haptics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("__DEV__", false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps named haptic events to distinct Expo patterns", async () => {
    const haptics = await import("expo-haptics");
    const { playHaptic } = await import("../../apps/mobile/lib/haptics.js");
    const impactAsync = haptics.impactAsync as Mock;
    const notificationAsync = haptics.notificationAsync as Mock;

    await playHaptic("messageSent");
    await playHaptic("voiceRecordingStop");
    await playHaptic("taskDeleted");
    await playHaptic("toolApprovalRequested");
    await playHaptic("error");

    expect(impactAsync).toHaveBeenCalledWith("Light");
    expect(impactAsync).toHaveBeenCalledWith("Medium");
    expect(impactAsync).toHaveBeenCalledWith("Heavy");
    expect(notificationAsync).toHaveBeenCalledWith("Warning");
    expect(notificationAsync).toHaveBeenCalledWith("Error");
  });

  it("respects the haptic feedback preference", async () => {
    const haptics = await import("expo-haptics");
    const { playHaptic } = await import("../../apps/mobile/lib/haptics.js");
    const { useAppStore } = await import("../../apps/mobile/lib/store.js");
    const impactAsync = haptics.impactAsync as Mock;
    impactAsync.mockClear();

    useAppStore.getState().setHapticsEnabled(false);
    await playHaptic("messageSent");

    expect(impactAsync).not.toHaveBeenCalled();
  });
});
