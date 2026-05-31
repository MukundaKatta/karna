import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// expo-notifications and react-native are native-only; mock them so the module
// imports cleanly under Node. The actual dispatch logic is exercised through an
// injected fake backend, so these mocks only need to exist.
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
  notifyApprovalNeeded,
  notifyRunComplete,
  shouldNotify,
  cancelKarnaNotification,
  setNotificationBackend,
  type KarnaNotificationData,
  type KarnaNotificationPreferences,
  type NotificationBackend,
} from "../../../karna/apps/mobile/lib/notifications";

const allEnabled: KarnaNotificationPreferences = {
  enabled: true,
  approvalsEnabled: true,
  runCompletionEnabled: true,
};

interface Dispatched {
  title: string;
  body: string;
  data: KarnaNotificationData;
}

function makeFakeBackend() {
  const scheduled: Dispatched[] = [];
  const cancelled: string[] = [];
  let counter = 0;
  const backend: NotificationBackend = {
    async scheduleImmediate(title, body, data) {
      scheduled.push({ title, body, data });
      return `notif-${++counter}`;
    },
    async cancel(id) {
      cancelled.push(id);
    },
  };
  return { backend, scheduled, cancelled };
}

describe("notification dispatch (issue #612)", () => {
  let fake: ReturnType<typeof makeFakeBackend>;

  beforeEach(() => {
    fake = makeFakeBackend();
    setNotificationBackend(fake.backend);
  });

  afterEach(() => {
    setNotificationBackend();
  });

  it("dispatches an approval-needed notification deep-linking to tasks", async () => {
    const id = await notifyApprovalNeeded(
      { toolName: "shell.exec", toolCallId: "tc-1", riskLevel: "high" },
      allEnabled,
    );

    expect(id).toBe("notif-1");
    expect(fake.scheduled).toHaveLength(1);
    const [n] = fake.scheduled;
    expect(n.title).toBe("Approval needed");
    expect(n.body).toContain("shell.exec");
    expect(n.body).toContain("high");
    expect(n.data.kind).toBe("approval-needed");
    expect(n.data.tab).toBe("tasks");
    expect(n.data.toolCallId).toBe("tc-1");
  });

  it("dispatches a run-complete notification deep-linking to tasks", async () => {
    const id = await notifyRunComplete(
      { title: "Nightly report", runId: "run-9", success: true },
      allEnabled,
    );

    expect(id).toBe("notif-1");
    const [n] = fake.scheduled;
    expect(n.title).toBe("Task complete");
    expect(n.body).toContain("Nightly report");
    expect(n.body).toContain("completed");
    expect(n.data.kind).toBe("run-complete");
    expect(n.data.tab).toBe("tasks");
    expect(n.data.runId).toBe("run-9");
  });

  it("marks failed runs in the body", async () => {
    await notifyRunComplete(
      { title: "Backup", success: false },
      allEnabled,
    );
    expect(fake.scheduled[0].body).toContain("finished with errors");
  });

  it("suppresses notifications when master switch is off", async () => {
    const prefs: KarnaNotificationPreferences = {
      ...allEnabled,
      enabled: false,
    };
    expect(await notifyApprovalNeeded({ toolName: "x", toolCallId: "1" }, prefs)).toBeNull();
    expect(await notifyRunComplete({ title: "y" }, prefs)).toBeNull();
    expect(fake.scheduled).toHaveLength(0);
  });

  it("respects per-kind opt-out", async () => {
    const noApprovals: KarnaNotificationPreferences = {
      enabled: true,
      approvalsEnabled: false,
      runCompletionEnabled: true,
    };
    expect(
      await notifyApprovalNeeded({ toolName: "x", toolCallId: "1" }, noApprovals),
    ).toBeNull();
    // run-complete still fires
    expect(await notifyRunComplete({ title: "y" }, noApprovals)).toBe("notif-1");
    expect(fake.scheduled).toHaveLength(1);
  });

  it("shouldNotify encodes the preference policy", () => {
    expect(shouldNotify("approval-needed", allEnabled)).toBe(true);
    expect(shouldNotify("run-complete", allEnabled)).toBe(true);
    expect(
      shouldNotify("approval-needed", { ...allEnabled, approvalsEnabled: false }),
    ).toBe(false);
    expect(
      shouldNotify("run-complete", { ...allEnabled, runCompletionEnabled: false }),
    ).toBe(false);
    expect(shouldNotify("approval-needed", { ...allEnabled, enabled: false })).toBe(
      false,
    );
  });

  it("cancels through the injected backend", async () => {
    const id = await notifyApprovalNeeded(
      { toolName: "x", toolCallId: "1" },
      allEnabled,
    );
    expect(id).not.toBeNull();
    await cancelKarnaNotification(id as string);
    expect(fake.cancelled).toEqual([id]);
  });
});
