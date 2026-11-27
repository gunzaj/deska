// Where a day's meetings sit on a time grid (CALENDAR-SPEC §3.2, §3.5). Pure
// and framework-free: the panel only renders what this returns, and the tests
// pin the hard parts (overlaps, all-day events, DST, midnight).
//
// Positions are wall-clock minutes from midnight in the viewer's zone, as a
// calendar draws them: on a spring-forward day the 02:00 row is skipped, on a
// fall-back day the 02:00 row is drawn once.
import { addDays, localToday, localTime, zonedToUtc } from "../tasks/dates";
import type { CalendarEventView } from "./types";

/** 24:00, the end of a day for layout purposes. */
export const DAY_MINUTES = 24 * 60;

export type GridEvent = {
  event: CalendarEventView;
  /** Minutes from midnight on the shown day. */
  startMin: number;
  endMin: number;
  /** Overlapping events sit side by side: 0-based column and how many columns the group has. */
  column: number;
  columns: number;
  /** The event started before this day or ends after it. */
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type CalendarDay = {
  /** YYYY-MM-DD in the viewer's zone. */
  day: string;
  allDay: CalendarEventView[];
  timed: GridEvent[];
  /** The grid's window in minutes: working hours, grown to fit earlier or later events. */
  windowStart: number;
  windowEnd: number;
  /** "Now" as minutes from midnight, only on the viewer's today; else null. */
  nowMin: number | null;
};

export type DayLayoutOptions = {
  /** Viewer's zone. */
  tz: string;
  workStart: string;
  workEnd: string;
  hideDeclined: boolean;
  /** The page clock; defaults to the current instant. */
  now?: Date;
};

/** "14:30" → 870. */
export function hhmmToMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** 870 → "14:30". */
export function minutesToHhmm(min: number): string {
  const m = Math.max(0, Math.min(DAY_MINUTES, Math.round(min)));
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Wall-clock minutes from midnight of `instant` in `tz`. */
export function minuteOfDay(instant: Date | number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

/** The instant a day starts in `tz`. */
export function dayStart(day: string, tz: string): Date {
  return zonedToUtc(day, "00:00", tz);
}

/** The instant the next day starts in `tz` (a day can be 23 or 25 hours). */
export function dayEnd(day: string, tz: string): Date {
  return zonedToUtc(addDays(day, 1), "00:00", tz);
}

/**
 * The days an all-day event covers, in its own zone. EventKit gives an
 * all-day event a start and an end instant; an end at midnight is the exclusive
 * end of the last day, any later time is the last day itself. All-day events
 * are dates, never shifted into another zone (§3.4).
 */
export function allDayDates(event: Pick<CalendarEventView, "start" | "end" | "allDay" | "timeZone">, tz: string): string[] {
  const zone = event.timeZone ?? tz;
  const startMs = Date.parse(event.start);
  const endMs = Date.parse(event.end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return [];
  const first = localToday(new Date(startMs), zone);
  const last = localToday(new Date(Math.max(endMs - 1, startMs)), zone);
  const out: string[] = [];
  for (let d = first; d <= last && out.length < 370; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Whether the event appears on `day`: an all-day event on its dates, a timed one when it overlaps. */
export function eventOnDay(event: Pick<CalendarEventView, "start" | "end" | "allDay" | "timeZone">, day: string, tz: string): boolean {
  if (event.allDay) return allDayDates(event, tz).includes(day);
  const startMs = Date.parse(event.start);
  const endMs = Date.parse(event.end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
  return startMs < dayEnd(day, tz).getTime() && endMs > dayStart(day, tz).getTime();
}

/** Meetings on a day, declined ones included unless hidden. All-day events count once. */
export function meetingsOn(events: readonly CalendarEventView[], day: string, tz: string, hideDeclined: boolean): CalendarEventView[] {
  return events.filter((e) => (!hideDeclined || e.myStatus !== "declined") && eventOnDay(e, day, tz));
}

/** "N meetings today": timed meetings only, the Home context line (§3.2). */
export function countMeetings(events: readonly CalendarEventView[], day: string, tz: string): number {
  return meetingsOn(events, day, tz, false).filter((e) => !e.allDay).length;
}

type Columned = { startMin: number; endMin: number; column: number; columns: number };

/**
 * Side-by-side columns for overlapping intervals. Each contiguous overlapping
 * group gets as many columns as it needs; every member spans 1/columns of the
 * width, so two meetings at 10:00 split the column in half.
 */
function assignColumns(items: { startMin: number; endMin: number }[]): Columned[] {
  const sorted = items.map((i, index) => ({ ...i, index })).sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.index - b.index);
  // One result per input item, in the caller's order.
  const out: Columned[] = items.map(() => ({ startMin: 0, endMin: 0, column: 0, columns: 1 }));
  let group: typeof sorted = [];
  let groupEnd = -1;
  const flush = () => {
    if (group.length === 0) return;
    const columnEnds: number[] = [];
    const placed = group.map((item) => {
      let column = columnEnds.findIndex((end) => end <= item.startMin);
      if (column < 0) {
        column = columnEnds.length;
        columnEnds.push(item.endMin);
      } else {
        columnEnds[column] = item.endMin;
      }
      return { ...item, column };
    });
    for (const p of placed) out[p.index] = { startMin: p.startMin, endMin: p.endMin, column: p.column, columns: columnEnds.length };
    group = [];
    groupEnd = -1;
  };
  for (const item of sorted) {
    if (group.length > 0 && item.startMin >= groupEnd) flush();
    group.push(item);
    groupEnd = Math.max(groupEnd, item.endMin);
  }
  flush();
  return out;
}

/**
 * The day's grid: all-day events in their band, timed events clipped to the
 * day and placed in columns, the window from the working hours grown to fit
 * anything earlier or later, and the now-line on the viewer's today.
 */
export function layoutDay(events: readonly CalendarEventView[], day: string, opts: DayLayoutOptions): CalendarDay {
  const { tz, hideDeclined } = opts;
  const shown = events.filter((e) => !hideDeclined || e.myStatus !== "declined");
  const startMs = dayStart(day, tz).getTime();
  const endMs = dayEnd(day, tz).getTime();
  const allDay = shown.filter((e) => e.allDay && allDayDates(e, tz).includes(day));
  const timed: GridEvent[] = [];
  for (const event of shown) {
    if (event.allDay) continue;
    const s = Date.parse(event.start);
    const e = Date.parse(event.end);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= startMs || s >= endMs) continue;
    const clippedStart = Math.max(s, startMs);
    const clippedEnd = Math.min(e, endMs);
    // Midnight at either edge is 00:00 / 24:00 of this day, not of the next one.
    const startMin = clippedStart <= startMs ? 0 : minuteOfDay(clippedStart, tz);
    const endMin = clippedEnd >= endMs ? DAY_MINUTES : minuteOfDay(clippedEnd, tz);
    if (endMin <= startMin) continue;
    timed.push({ event, startMin, endMin, column: 0, columns: 1, continuesBefore: s < startMs, continuesAfter: e > endMs });
  }
  const columns = assignColumns(timed);
  const placed = timed.map((t, i) => ({ ...t, column: columns[i]!.column, columns: columns[i]!.columns }));

  const workStart = Math.max(0, Math.min(hhmmToMinutes(opts.workStart), DAY_MINUTES));
  const workEnd = Math.max(0, Math.min(hhmmToMinutes(opts.workEnd), DAY_MINUTES));
  let windowStart = Math.min(workStart, ...placed.map((p) => p.startMin));
  let windowEnd = Math.max(workEnd, ...placed.map((p) => p.endMin));
  if (!(windowEnd > windowStart)) {
    windowStart = workStart;
    windowEnd = workEnd > workStart ? workEnd : DAY_MINUTES;
  }

  const now = opts.now ?? new Date();
  const today = localToday(now, tz);
  return {
    day,
    allDay,
    timed: placed,
    windowStart,
    windowEnd,
    nowMin: today === day ? minuteOfDay(now, tz) : null,
  };
}

export type NextMeeting =
  | { kind: "now"; title: string; until: string }
  | { kind: "next"; title: string; minutes: number }
  | { kind: "free"; until: string | null };

/** "Next: design review in 25 min", or the free time until the next meeting (§3.2). */
export function nextMeeting(events: readonly CalendarEventView[], now: Date, tz: string, hideDeclined: boolean): NextMeeting {
  const day = localToday(now, tz);
  const nowMs = now.getTime();
  const timed = events
    .filter((e) => !e.allDay && (!hideDeclined || e.myStatus !== "declined") && eventOnDay(e, day, tz))
    .map((e) => ({ event: e, start: Date.parse(e.start), end: Date.parse(e.end) }))
    .filter((e) => !Number.isNaN(e.start) && !Number.isNaN(e.end))
    .sort((a, b) => a.start - b.start);
  const current = timed.find((e) => e.start <= nowMs && e.end > nowMs);
  if (current) return { kind: "now", title: current.event.title, until: localTime(new Date(current.end), tz) };
  const next = timed.find((e) => e.start > nowMs);
  if (!next) return { kind: "free", until: null };
  const minutes = Math.ceil((next.start - nowMs) / 60_000);
  if (minutes <= 120) return { kind: "next", title: next.event.title, minutes };
  return { kind: "free", until: localTime(new Date(next.start), tz) };
}

/** "14:00–15:30", or "All day" for an all-day event, in the viewer's zone. */
export function eventTimeLabel(event: Pick<CalendarEventView, "start" | "end" | "allDay">, tz: string): string {
  if (event.allDay) return "All day";
  return `${localTime(new Date(event.start), tz)}–${localTime(new Date(event.end), tz)}`;
}

/** The event's own zone when it differs from the viewer's, for the popover (§3.4). */
export function eventZoneNote(event: Pick<CalendarEventView, "timeZone" | "allDay">, tz: string): string | null {
  if (event.allDay || !event.timeZone || event.timeZone === tz) return null;
  return event.timeZone;
}
