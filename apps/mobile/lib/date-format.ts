import * as Localization from "expo-localization";

export function getDeviceTimeZone(): string | undefined {
  const calendarTimeZone = Localization.getCalendars()[0]?.timeZone;
  return calendarTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatReminderDueDate(
  dueDateUtcMs: number,
  options: { locale?: string; timeZone?: string } = {},
): string {
  const locale = options.locale ?? Localization.getLocales()[0]?.languageTag;
  const timeZone = options.timeZone ?? getDeviceTimeZone();

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(dueDateUtcMs));
}
