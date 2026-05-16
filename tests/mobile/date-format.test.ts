import { describe, expect, it, vi } from "vitest";

vi.mock("expo-localization", () => ({
  getCalendars: () => [{ timeZone: "America/Los_Angeles" }],
  getLocales: () => [{ languageTag: "en-US" }],
}));

describe("mobile date formatting", () => {
  it("formats UTC reminder timestamps in the requested local timezone", async () => {
    const { formatReminderDueDate } = await import(
      "../../apps/mobile/lib/date-format.js"
    );

    const timestamp = Date.UTC(2026, 0, 1, 17, 0);

    expect(
      formatReminderDueDate(timestamp, {
        locale: "en-US",
        timeZone: "America/Los_Angeles",
      }),
    ).toContain("9:00 AM");
    expect(
      formatReminderDueDate(timestamp, {
        locale: "en-US",
        timeZone: "UTC",
      }),
    ).toContain("5:00 PM");
  });

  it("uses the Expo device timezone when no override is provided", async () => {
    const { formatReminderDueDate, getDeviceTimeZone } = await import(
      "../../apps/mobile/lib/date-format.js"
    );

    expect(getDeviceTimeZone()).toBe("America/Los_Angeles");
    expect(formatReminderDueDate(Date.UTC(2026, 0, 1, 17, 0))).toContain(
      "9:00 AM",
    );
  });
});
