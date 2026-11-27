// Where the server gets calendar data (CALENDAR-SPEC §2.2): from main over the
// IPC channel, never from the network and never from the database. Without a
// main process (the browser preview, e2e, unit tests) a JSON fixture named by
// `DESKA_CALENDAR_FIXTURE` answers instead; main passes that variable only from
// an unpackaged build, and a fixture is never read in a packaged app.
import { readFileSync } from "node:fs";
import { isMeetingUrl } from "./join";
import type { CalendarEvent, CalendarFixture, CalendarInfo, CalendarReadStatus } from "./types";

export type CalendarCommand = "status" | "calendars" | "events";

type Request = (cmd: CalendarCommand, args?: Record<string, unknown>) => Promise<unknown>;
const REQUEST = Symbol.for("deska.calendarRequest");

/** The channel main installs in server-entry.ts; absent in the browser dev server and e2e. */
function mainRequest(): Request | null {
  const fn = (globalThis as Record<symbol, unknown>)[REQUEST];
  return typeof fn === "function" ? (fn as Request) : null;
}

function fixture(): CalendarFixture | null {
  const file = process.env.DESKA_CALENDAR_FIXTURE;
  if (!file) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<CalendarFixture>;
    const calendars = Array.isArray(raw.calendars) ? raw.calendars.filter(isCalendar) : [];
    const events = Array.isArray(raw.events) ? raw.events.filter(isEvent) : [];
    return { status: typeof raw.status === "string" ? (raw.status as CalendarReadStatus) : "fullAccess", calendars, events };
  } catch {
    // An unreadable fixture is an app that cannot read calendars, not a crash.
    return null;
  }
}

function isCalendar(v: unknown): v is CalendarInfo {
  const c = v as Partial<CalendarInfo>;
  return !!c && typeof c.id === "string" && typeof c.title === "string";
}

function isEvent(v: unknown): v is CalendarEvent {
  const e = v as Partial<CalendarEvent>;
  return !!e && typeof e.id === "string" && typeof e.calendarId === "string" && typeof e.start === "string" && typeof e.end === "string" && typeof e.allDay === "boolean";
}

/** Fill in what a hand-written fixture may leave out. */
function normalizeCalendar(c: CalendarInfo): CalendarInfo {
  return { id: c.id, title: c.title, color: typeof c.color === "string" ? c.color : "#7a7a7a", source: typeof c.source === "string" ? c.source : "", allowsWrite: c.allowsWrite === true, subscribed: c.subscribed === true, birthday: c.birthday === true };
}

function normalizeEvent(e: CalendarEvent): CalendarEvent {
  return {
    id: e.id,
    calendarId: e.calendarId,
    title: typeof e.title === "string" ? e.title : "",
    start: e.start,
    end: e.end,
    allDay: e.allDay === true,
    timeZone: typeof e.timeZone === "string" ? e.timeZone : null,
    location: typeof e.location === "string" ? e.location : null,
    url: typeof e.url === "string" ? e.url : null,
    meetingUrl: typeof e.meetingUrl === "string" && isMeetingUrl(e.meetingUrl) ? e.meetingUrl : null,
    myStatus: e.myStatus ?? null,
    organizerIsMe: e.organizerIsMe === true,
    attendeeCount: typeof e.attendeeCount === "number" ? e.attendeeCount : 0,
    isRecurring: e.isRecurring === true,
    occurrenceDate: typeof e.occurrenceDate === "string" ? e.occurrenceDate : null,
  };
}

async function ask<T>(cmd: CalendarCommand, args?: Record<string, unknown>): Promise<T | null> {
  const request = mainRequest();
  if (request) return (await request(cmd, args)) as T;
  const f = fixture();
  if (!f) return null;
  if (cmd === "status") return f.status as unknown as T;
  if (cmd === "calendars") return f.calendars.map(normalizeCalendar) as unknown as T;
  if (cmd === "events") {
    const from = Date.parse(String(args?.from ?? ""));
    const to = Date.parse(String(args?.to ?? ""));
    const ids = Array.isArray(args?.calendarIds) ? new Set((args.calendarIds as unknown[]).filter((x): x is string => typeof x === "string")) : null;
    if (Number.isNaN(from) || Number.isNaN(to)) return [] as unknown as T;
    return f.events
      .map(normalizeEvent)
      .filter((e) => (!ids || ids.has(e.calendarId)) && Date.parse(e.start) < to && Date.parse(e.end) > from) as unknown as T;
  }
  return null;
}

/** macOS's answer; "unavailable" when neither main nor a fixture can answer. */
export async function calendarStatus(): Promise<CalendarReadStatus> {
  try {
    const s = await ask<string>("status");
    return s === "notDetermined" || s === "denied" || s === "restricted" || s === "fullAccess" || s === "writeOnly" ? s : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** The calendars this Mac has. Throws when the helper cannot answer. */
export async function readCalendars(): Promise<CalendarInfo[]> {
  const list = await ask<CalendarInfo[]>("calendars");
  return Array.isArray(list) ? list.filter(isCalendar).map(normalizeCalendar) : [];
}

/** The calendars this Mac has; empty when access is not granted or the read failed (Settings). */
export async function calendarCalendars(): Promise<CalendarInfo[]> {
  try {
    return await readCalendars();
  } catch {
    return [];
  }
}

/** Events overlapping [from, to). Both are ISO instants; the helper caps the window at 42 days. */
export async function calendarEvents(from: Date, to: Date, calendarIds: readonly string[]): Promise<CalendarEvent[]> {
  const list = await ask<CalendarEvent[]>("events", { from: from.toISOString(), to: to.toISOString(), calendarIds: [...calendarIds] });
  return Array.isArray(list) ? list.filter(isEvent).map(normalizeEvent) : [];
}
