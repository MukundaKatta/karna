import { describe, expect, it } from "vitest";
import {
  applyDashboardTheme,
  getSystemDashboardTheme,
  readStoredDashboardSettings,
} from "../../apps/web/lib/store.js";

describe("dashboard sidebar navigation", () => {
  it("returns empty stored settings on the server", () => {
    expect(readStoredDashboardSettings()).toEqual({});
  });

  it("defaults to a server-safe dark dashboard theme", () => {
    expect(getSystemDashboardTheme()).toBe("dark");
    expect(() => applyDashboardTheme("light")).not.toThrow();
  });
});
