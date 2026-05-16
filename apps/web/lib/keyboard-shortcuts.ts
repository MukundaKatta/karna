export const DASHBOARD_SHORTCUT_ROUTES = [
  "/dashboard",
  "/dashboard/agents",
  "/dashboard/sessions",
  "/dashboard/skills",
  "/dashboard/tools",
  "/dashboard/memory",
  "/dashboard/moderation",
  "/dashboard/analytics",
  "/observability",
] as const;

export const WEB_SHORTCUT_EVENTS = {
  newChat: "karna:web:new-chat",
  sendChat: "karna:web:send-chat",
  toggleVoice: "karna:web:toggle-voice",
  closeOverlays: "karna:web:close-overlays",
} as const;

export type WebShortcutEventName =
  (typeof WEB_SHORTCUT_EVENTS)[keyof typeof WEB_SHORTCUT_EVENTS];

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.closest('[contenteditable="true"]') !== null
  );
}

export function isCommandModifier(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">): boolean {
  return event.metaKey || event.ctrlKey;
}

export function getDashboardShortcutRoute(key: string): string | undefined {
  if (!/^[1-9]$/.test(key)) {
    return undefined;
  }

  return DASHBOARD_SHORTCUT_ROUTES[Number(key) - 1];
}
