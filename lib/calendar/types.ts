// Calendar data shapes shared by main's helper bridge, the server and the
// browser (CALENDAR-SPEC §2.2, §3). Framework-free and free of Node imports.
//
// Event data is read from macOS on demand and lives in memory only: it is never
// written to the database, a log, a backup or an AI input (§2, C-F).

/** What macOS says about the Calendars permission (CALENDAR-SPEC §2.2). */
export const CALENDAR_STATUSES = ["notDetermined", "denied", "restricted", "fullAccess", "writeOnly"] as const;
export type CalendarStatus = (typeof CALENDAR_STATUSES)[number];
/**
 * Not a macOS answer: the helper is missing or did not start (a dev build
 * without `swift build`, a broken bundle). Reads fail like `denied`.
 */
export type CalendarReadStatus = CalendarStatus | "unavailable";

/** A calendar in Calendar.app, as Settings lists it. */
export type CalendarInfo = {
  id: string;
  title: string;
  /** "#rrggbb" as Calendar.app shows it. */
  color: string;
  /** The account the calendar belongs to ("iCloud", "Google", …). */
  source: string;
  allowsWrite: boolean;
  /** A subscribed calendar (an ICS feed, or the holidays calendar). */
  subscribed: boolean;
  /** macOS's Birthdays calendar. */
  birthday: boolean;
};

/** How the user answered the invitation, when the event has attendees. */
export type CalendarAttendeeStatus = "accepted" | "declined" | "tentative" | "pending" | "delegated" | "unknown";

/**
 * One event, exactly the fields the helper sends (CALENDAR-SPEC §2.2). No
 * notes text, no attendee names or emails; `attendeeCount` is only a number.
 */
export type CalendarEvent = {
  id: string;
  calendarId: string;
  title: string;
  /** ISO instant. */
  start: string;
  /** ISO instant, exclusive for all-day events. */
  end: string;
  allDay: boolean;
  /** The zone the event was created in; null when it has none. */
  timeZone: string | null;
  location: string | null;
  url: string | null;
  /** An allowlisted meeting link the helper found in the event's notes; the notes themselves never leave it. */
  meetingUrl: string | null;
  myStatus: CalendarAttendeeStatus | null;
  organizerIsMe: boolean;
  attendeeCount: number;
  isRecurring: boolean;
  /** The occurrence's own date (ISO instant) for a recurring event. */
  occurrenceDate: string | null;
};

/** An event as the browser gets it: the calendar's name and colour for drawing, and a checked meeting link. */
export type CalendarEventView = CalendarEvent & {
  calendarTitle: string;
  calendarColor: string;
  /** An https meeting link on the allowlist in `join.ts`; null when the event has none. */
  joinUrl: string | null;
};

/** What the server answers for `GET /api/calendar/events` (CALENDAR-SPEC §2.2). */
export type CalendarEventsResponse = {
  status: CalendarReadStatus;
  /** The user turned calendar reading on and macOS allows it. */
  connected: boolean;
  calendars: Pick<CalendarInfo, "id" | "title" | "color">[];
  events: CalendarEventView[];
  /** The read's instant, so the panel can say how old the result is. */
  readAt: string;
  /** The drawing rules the panel needs, so it does not ask twice (§3.2). */
  prefs: { hideDeclined: boolean; weekStart: "monday" | "sunday"; workStart: string; workEnd: string };
};

/** A JSON fixture for tests and dev (`DESKA_CALENDAR_FIXTURE`), never used by a packaged build. */
export type CalendarFixture = {
  status: CalendarReadStatus;
  calendars: CalendarInfo[];
  events: CalendarEvent[];
};
