import { z } from "zod";
import { HttpError, route } from "@/lib/server/route";
import { meetingJoinUrl } from "@/lib/calendar/join";
import { calendarCalendars, calendarEvents, calendarStatus } from "@/lib/calendar/provider";
import type { CalendarEventView, CalendarReadStatus } from "@/lib/calendar/types";
import { readCalendarPrefs } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** The helper reads a window of up to 42 days (CALENDAR-SPEC §2.2). */
const MAX_WINDOW_MS = 42 * 86_400_000;

const query = z
  .object({
    /** ISO instants; the caller computes them from its own zone. */
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .strict();

const MAY_READ: readonly CalendarReadStatus[] = ["fullAccess", "writeOnly"];

/**
 * Today's (or a day's) meetings for the Home panel and the Planner
 * (CALENDAR-SPEC §2.2, §3.2). Read from macOS on demand; nothing here is
 * stored. A read failure is an error, so a client keeps its last result and
 * marks it stale (§3.3: an error is never shown as an empty list).
 */
export const GET = route({ auth: "viewer", query, invalid: "invalid calendar window" }, async ({ query: { from, to } }) => {
  const start = new Date(from);
  const end = new Date(to);
  const span = end.getTime() - start.getTime();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || span <= 0 || span > MAX_WINDOW_MS) {
    throw new HttpError(400, "invalid calendar window");
  }

  const status = await calendarStatus();
  const prefs = await readCalendarPrefs();
  const readAt = new Date().toISOString();
  const drawing = { hideDeclined: prefs.hideDeclined, weekStart: prefs.weekStart, workStart: prefs.workStart, workEnd: prefs.workEnd };
  if (!prefs.enabled || !MAY_READ.includes(status)) {
    return { status, connected: prefs.enabled && MAY_READ.includes(status), calendars: [], events: [], readAt, prefs: drawing };
  }

  const calendars = await calendarCalendars();
  const chosen = calendars.filter((c) => prefs.calendarIds.includes(c.id));
  if (chosen.length === 0) return { status, connected: true, calendars: [], events: [], readAt, prefs: drawing };
  const byId = new Map(chosen.map((c) => [c.id, c]));

  const events = await calendarEvents(start, end, chosen.map((c) => c.id));
  const views: CalendarEventView[] = [];
  for (const event of events) {
    if (prefs.hideDeclined && event.myStatus === "declined") continue;
    const calendar = byId.get(event.calendarId);
    // An event on a calendar that is no longer chosen (it changed under us) is left out.
    if (!calendar) continue;
    views.push({ ...event, calendarTitle: calendar.title, calendarColor: calendar.color, joinUrl: meetingJoinUrl(event) });
  }
  views.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.title.localeCompare(b.title));
  return { status, connected: true, calendars: chosen.map((c) => ({ id: c.id, title: c.title, color: c.color })), events: views, readAt, prefs: drawing };
});
