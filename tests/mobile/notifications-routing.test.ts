import { describe, it, expect, vi } from "vitest";

vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  cancelAllScheduledNotificationsAsync: vi.fn(),
  addNotificationReceivedListener: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

import {
  parseKarnaNotificationData,
  notificationTabForKind,
} from "../../../karna/apps/mobile/lib/notifications";
import { getMobileTabRoute } from "../../../karna/apps/mobile/lib/deep-links";

describe("notification response routing (issue #612)", () => {
  it("parses approval-needed payloads and routes to the tasks tab", () => {
    const data = parseKarnaNotificationData({
      kind: "approval-needed",
      tab: "tasks",
      toolCallId: "tc-1",
    });
    expect(data).not.toBeNull();
    expect(data?.kind).toBe("approval-needed");
    expect(data?.toolCallId).toBe("tc-1");
    expect(getMobileTabRoute(data?.tab)).toBe("/(tabs)/tasks");
  });

  it("parses run-complete payloads and routes to the tasks tab", () => {
    const data = parseKarnaNotificationData({
      kind: "run-complete",
      tab: "tasks",
      runId: "run-7",
    });
    expect(data?.kind).toBe("run-complete");
    expect(data?.runId).toBe("run-7");
    expect(getMobileTabRoute(data?.tab)).toBe("/(tabs)/tasks");
  });

  it("falls back to the kind's default tab when tab is missing", () => {
    const data = parseKarnaNotificationData({ kind: "approval-needed" });
    expect(data?.tab).toBe(notificationTabForKind("approval-needed"));
    expect(getMobileTabRoute(data?.tab)).toBe("/(tabs)/tasks");
  });

  it("returns null for non-Karna payloads", () => {
    expect(parseKarnaNotificationData(undefined)).toBeNull();
    expect(parseKarnaNotificationData(null)).toBeNull();
    expect(parseKarnaNotificationData({ tab: "chat" })).toBeNull();
    expect(parseKarnaNotificationData({ kind: "other" })).toBeNull();
    expect(parseKarnaNotificationData("string")).toBeNull();
  });

  it("ignores non-string id fields defensively", () => {
    const data = parseKarnaNotificationData({
      kind: "run-complete",
      tab: "tasks",
      runId: 123,
    });
    expect(data?.runId).toBeUndefined();
  });
});
