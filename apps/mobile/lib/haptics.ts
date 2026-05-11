import * as Haptics from "expo-haptics";
import { useAppStore } from "./store";

export type MobileHapticEvent =
  | "messageSent"
  | "messageReceived"
  | "toolApprovalRequested"
  | "error"
  | "taskCompleted"
  | "taskDeleted"
  | "taskSnoozed"
  | "success"
  | "voiceRecordingStart"
  | "voiceRecordingStop"
  | "voiceLiveToggle"
  | "pullToRefresh"
  | "selection";

export async function playHaptic(event: MobileHapticEvent): Promise<void> {
  if (!useAppStore.getState().hapticsEnabled) {
    return;
  }

  switch (event) {
    case "messageSent":
    case "voiceRecordingStart":
    case "pullToRefresh":
    case "selection":
    case "taskSnoozed":
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    case "taskCompleted":
    case "voiceRecordingStop":
    case "voiceLiveToggle":
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    case "taskDeleted":
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    case "messageReceived":
    case "success":
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    case "toolApprovalRequested":
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    case "error":
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
  }
}
