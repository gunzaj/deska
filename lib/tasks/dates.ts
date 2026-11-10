// Due-date helpers for the browser. Dates are plain YYYY-MM-DD strings and are
// compared as strings; "today" is the viewer's local calendar day (§12.5).

/** Today's date in the browser's time zone (or `tz`), as YYYY-MM-DD. */
export function localToday(now = new Date(), tz?: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** A real calendar date from its parts, or null when that day doesn't exist (31 Feb). */
export function ymd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** `n` months on, the day clamped to the month's length (31 Jan + 1 -> 28 Feb). */
export function addMonths(date: string, n: number): string {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return ymd(ny, nm, Math.min(d, last))!;
}

/**
 * A real calendar date, YYYY-MM-DD. The regex alone accepts impossible dates
 * ("2024-02-30"), which `new Date()` silently rolls over to another day.
 */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type DueTone = "overdue" | "today" | "soon" | "later";

/** Todoist-style label: Yesterday / Today / Tomorrow / weekday this week / "20 Oct". */
export function dueLabel(date: string, today: string): { text: string; tone: DueTone } {
  if (date === today) return { text: "Today", tone: "today" };
  if (date === addDays(today, 1)) return { text: "Tomorrow", tone: "soon" };
  if (date === addDays(today, -1)) return { text: "Yesterday", tone: "overdue" };
  const d = new Date(`${date}T00:00:00Z`);
  const tone: DueTone = date < today ? "overdue" : "later";
  if (date > today && date <= addDays(today, 6)) {
    return { text: d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }), tone: "soon" };
  }
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return {
    text: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }),
    tone,
  };
}

/** Minutes east of UTC that `tz` is at the instant `utcMs`. */
function offsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60_000);
}

/**
 * The UTC instant of a wall-clock date and time in `tz` (e.g. a due time of
 * 15:00 in Europe/Prague). Around a DST change the zone has two offsets, the
 * one before it and the one after; a wall time that one of them reproduces is
 * that instant (the earlier one when a fall-back repeats the hour). A time
 * skipped by a spring-forward reproduces under neither: read with the offset
 * from before the change it lands just after the gap (02:30 → 03:30), in
 * zones east and west of UTC alike.
 */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const DAY = 86_400_000;
  const before = offsetMinutes(wall - DAY, tz);
  const after = offsetMinutes(wall + DAY, tz);
  const valid = [before, after]
    .map((o) => wall - o * 60_000)
    .filter((utc) => wall - offsetMinutes(utc, tz) * 60_000 === utc)
    .sort((a, b) => a - b);
  return new Date(valid[0] ?? wall - before * 60_000);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `at` moved by `days` calendar days, keeping its wall-clock time in `tz` across DST. */
export function shiftInstant(at: string, days: number, tz: string): string {
  const d = new Date(at);
  return zonedToUtc(addDays(localToday(d, tz), days), localTime(d, tz), tz).toISOString();
}

/** Current wall-clock time in `tz` as HH:mm. */
export function localTime(now = new Date(), tz?: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/** Whether a string is an IANA time zone this runtime knows. */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
