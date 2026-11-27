import { route } from "@/lib/server/route";
import { applyCalendarPatch, calendarPrefsSchema, type CalendarPrefs } from "@/lib/calendar/settings";
import { calendarCalendars, calendarStatus } from "@/lib/calendar/provider";
import type { CalendarInfo, CalendarReadStatus } from "@/lib/calendar/types";
import { readCalendarPrefs, saveCalendarPrefs } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Write-only access cannot read events or calendars: only full access reads. */
const MAY_READ: readonly CalendarReadStatus[] = ["fullAccess"];

/**
 * Settings → Calendar (CALENDAR-SPEC §3.1): macOS's permission state, the
 * calendars it offers, and the saved prefs. Calendar names and colours only;
 * no event passes through this route.
 */
export const GET = route({ auth: "viewer" }, async () => {
  const status = await calendarStatus();
  const calendars = MAY_READ.includes(status) ? await calendarCalendars() : [];
  // IDs are per Mac: only filter against a list this Mac actually gave us.
  const prefs = await readCalendarPrefs(calendars.length > 0 ? calendars.map((c: CalendarInfo) => c.id) : undefined);
  return { status, calendars, prefs };
});

/** Save the calendar prefs. Calendar reading stays local; this writes one app setting. */
export const PATCH = route({ auth: "viewer", body: calendarPrefsSchema, invalid: "invalid calendar settings" }, async ({ body }) => {
  const status = await calendarStatus();
  const calendars = MAY_READ.includes(status) ? await calendarCalendars() : [];
  const known = calendars.length > 0 ? calendars.map((c: CalendarInfo) => c.id) : undefined;
  const current: CalendarPrefs = await readCalendarPrefs(known);
  const next = applyCalendarPatch(current, body);
  await saveCalendarPrefs(next);
  return { prefs: next };
});
