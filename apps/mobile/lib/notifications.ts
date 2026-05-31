import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { MobileTab } from './deep-links';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('[Notifications] Permission not granted');
      return null;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6366F1',
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    console.log('[Notifications] Push token:', tokenData.data);
    return tokenData.data;
  } catch (err) {
    console.error('[Notifications] Failed to register:', err);
    return null;
  }
}

export async function scheduleLocalNotification(
  title: string,
  body: string,
  triggerAt: Date,
): Promise<string> {
  const secondsUntilTrigger = Math.max(
    1,
    Math.floor((triggerAt.getTime() - Date.now()) / 1000),
  );

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsUntilTrigger,
    },
  });

  console.log('[Notifications] Scheduled notification:', id);
  return id;
}

export async function cancelNotification(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id);
}

export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export function addNotificationReceivedListener(
  handler: (notification: Notifications.Notification) => void,
): Notifications.Subscription {
  return Notifications.addNotificationReceivedListener(handler);
}

export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void,
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(handler);
}

// ── Karna notification dispatch (issue #612) ─────────────────────────────────
//
// All Expo-notifications side effects are routed through the small `NotificationBackend`
// interface below so the routing / scheduling logic can be unit-tested in a plain
// Node (vitest) environment without the native module. The default backend simply
// forwards to the real `expo-notifications` helpers defined above.

/** Categories of Karna notifications. Each maps to a deep-link target tab. */
export type KarnaNotificationKind = 'approval-needed' | 'run-complete';

/** Notification content + the deep-link data the response handler will route on. */
export interface KarnaNotificationData {
  /** Discriminator so the response handler can branch on notification kind. */
  kind: KarnaNotificationKind;
  /** Deep-link target tab consumed by `getMobileTabRoute` in the response handler. */
  tab: MobileTab;
  /** Tool call awaiting approval (approval-needed only). */
  toolCallId?: string;
  /** Originating run / orchestration id (run-complete only). */
  runId?: string;
}

/** User opt-in preferences for the two notification kinds. */
export interface KarnaNotificationPreferences {
  /** Master switch (mirrors the existing `notifications` store flag). */
  enabled: boolean;
  /** Notify when a tool/checkpoint needs human approval. */
  approvalsEnabled: boolean;
  /** Notify when a long-running task finishes. */
  runCompletionEnabled: boolean;
}

/**
 * Minimal surface of `expo-notifications` that the dispatch logic depends on.
 * Injecting this keeps the core routable/schedulable logic free of the native
 * module so it can run under vitest.
 */
export interface NotificationBackend {
  scheduleImmediate(
    title: string,
    body: string,
    data: KarnaNotificationData,
  ): Promise<string>;
  cancel(notificationId: string): Promise<void>;
}

const defaultBackend: NotificationBackend = {
  async scheduleImmediate(title, body, data) {
    return Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true, data: { ...data } },
      trigger: null,
    });
  },
  async cancel(notificationId) {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  },
};

let activeBackend: NotificationBackend = defaultBackend;

/** Override the notification backend (used by tests). Pass nothing to reset. */
export function setNotificationBackend(backend?: NotificationBackend): void {
  activeBackend = backend ?? defaultBackend;
}

/** Map a notification kind to its deep-link tab. */
export function notificationTabForKind(kind: KarnaNotificationKind): MobileTab {
  return kind === 'approval-needed' ? 'tasks' : 'tasks';
}

/**
 * Decide whether a notification of the given kind should be dispatched, given
 * the user's preferences. Exposed for testing and to keep the policy in one place.
 */
export function shouldNotify(
  kind: KarnaNotificationKind,
  preferences: KarnaNotificationPreferences,
): boolean {
  if (!preferences.enabled) return false;
  if (kind === 'approval-needed') return preferences.approvalsEnabled;
  return preferences.runCompletionEnabled;
}

/**
 * Dispatch an "approval needed" notification, deep-linking to the approvals
 * surface in the Tasks tab. Returns the scheduled notification id, or null when
 * preferences suppress it.
 */
export async function notifyApprovalNeeded(
  input: { toolName: string; toolCallId: string; riskLevel?: string },
  preferences: KarnaNotificationPreferences,
): Promise<string | null> {
  if (!shouldNotify('approval-needed', preferences)) return null;

  const risk = input.riskLevel ? ` (${input.riskLevel} risk)` : '';
  return activeBackend.scheduleImmediate(
    'Approval needed',
    `Karna wants to run "${input.toolName}"${risk}. Tap to review.`,
    {
      kind: 'approval-needed',
      tab: notificationTabForKind('approval-needed'),
      toolCallId: input.toolCallId,
    },
  );
}

/**
 * Dispatch a "run complete" notification for a finished long-running task,
 * deep-linking to the Tasks tab. Returns the scheduled notification id, or null
 * when preferences suppress it.
 */
export async function notifyRunComplete(
  input: { title: string; runId?: string; success?: boolean },
  preferences: KarnaNotificationPreferences,
): Promise<string | null> {
  if (!shouldNotify('run-complete', preferences)) return null;

  const outcome = input.success === false ? 'finished with errors' : 'completed';
  return activeBackend.scheduleImmediate(
    'Task complete',
    `"${input.title}" ${outcome}. Tap to view.`,
    {
      kind: 'run-complete',
      tab: notificationTabForKind('run-complete'),
      runId: input.runId,
    },
  );
}

/** Cancel a previously dispatched notification by id. */
export async function cancelKarnaNotification(id: string): Promise<void> {
  await activeBackend.cancel(id);
}

/**
 * Parse the `data` payload off a notification response into a typed Karna
 * notification, or return null when it is not a Karna notification. Pure and
 * unit-testable; the layout's response listener uses this to route deep links.
 */
export function parseKarnaNotificationData(
  data: unknown,
): KarnaNotificationData | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== 'approval-needed' && kind !== 'run-complete') return null;

  const tab =
    typeof record.tab === 'string'
      ? (record.tab as MobileTab)
      : notificationTabForKind(kind);

  return {
    kind,
    tab,
    toolCallId:
      typeof record.toolCallId === 'string' ? record.toolCallId : undefined,
    runId: typeof record.runId === 'string' ? record.runId : undefined,
  };
}
