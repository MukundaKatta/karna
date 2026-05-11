import { describe, expect, it } from "vitest";
import { readStoredDashboardSettings } from "../../apps/web/lib/store.js";

describe("dashboard sidebar navigation", () => {
  it("returns empty stored settings on the server", () => {
    expect(readStoredDashboardSettings()).toEqual({});
  });
});
