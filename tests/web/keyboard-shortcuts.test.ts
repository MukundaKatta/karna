import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SHORTCUT_ROUTES,
  getDashboardShortcutRoute,
  isCommandModifier,
  isEditableShortcutTarget,
} from "../../apps/web/lib/keyboard-shortcuts.js";

describe("web keyboard shortcuts", () => {
  it("maps command-number shortcuts to stable dashboard routes", () => {
    expect(DASHBOARD_SHORTCUT_ROUTES).toEqual([
      "/dashboard",
      "/dashboard/agents",
      "/dashboard/sessions",
      "/dashboard/skills",
      "/dashboard/tools",
      "/dashboard/memory",
      "/dashboard/moderation",
      "/dashboard/analytics",
      "/observability",
    ]);
    expect(getDashboardShortcutRoute("1")).toBe("/dashboard");
    expect(getDashboardShortcutRoute("8")).toBe("/dashboard/analytics");
    expect(getDashboardShortcutRoute("9")).toBe("/observability");
    expect(getDashboardShortcutRoute("0")).toBeUndefined();
  });

  it("detects command modifiers across macOS and Windows/Linux", () => {
    expect(isCommandModifier({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(isCommandModifier({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(isCommandModifier({ metaKey: false, ctrlKey: false })).toBe(false);
  });

  it("skips normal shortcuts while typing in editable fields", () => {
    expect(isEditableShortcutTarget(new EventTarget())).toBe(false);
    expect(isEditableShortcutTarget(null)).toBe(false);
  });
});
