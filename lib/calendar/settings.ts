// Calendar settings (CALENDAR-SPEC §3.1): one `app_settings` value,
// `calendar.prefs`, carried by backups and exports like every other setting.
// Calendar IDs belong to one Mac, so IDs this Mac does not know are dropped
// when prefs are read with the calendar list in hand.
import { z } from "zod";

export const DEFAULT_CALENDAR_PREFS = {
  enabled: false,
  calendarIds: [] as string[],
  hideDeclined: true,
  weekStart: "monday",
  workStart: "08:00",
  workEnd: "18:00",
} as const;

export type CalendarPrefs = {
  /** Reading is on (the user clicked "Connect calendars"). */
  enabled: boolean;
  /** The calendars to show; empty = none chosen yet. */
  calendarIds: string[];
  /** Leave out events the user declined. */
  hideDeclined: boolean;
  weekStart: "monday" | "sunday";
  /** Working hours, HH:mm; the grid opens on them and grows to fit early or late events. */
  workStart: string;
  workEnd: string;
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm");

export const calendarPrefsSchema = z
  .object({
    enabled: z.boolean(),
    calendarIds: z.array(z.string().min(1).max(200)).max(200),
    hideDeclined: z.boolean(),
    weekStart: z.enum(["monday", "sunday"]),
    workStart: hhmm,
    workEnd: hhmm,
  })
  .partial()
  .strict();

/** What may be saved through `PATCH /api/calendar`; an empty patch changes nothing. */
export type CalendarPrefsPatch = z.infer<typeof calendarPrefsSchema>;

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback;
}

/**
 * Read stored prefs defensively: an unreadable value is the default, and an
 * inverted working range (end before start) falls back to it.
 * `knownIds` are the calendars this Mac has: IDs outside it are dropped (§3.1).
 */
export function parseCalendarPrefs(value: unknown, knownIds?: Iterable<string>): CalendarPrefs {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const workStart = str(raw.workStart, DEFAULT_CALENDAR_PREFS.workStart);
  const workEnd = str(raw.workEnd, DEFAULT_CALENDAR_PREFS.workEnd);
  const validRange = hhmm.safeParse(workStart).success && hhmm.safeParse(workEnd).success && workStart < workEnd;
  const ids = Array.isArray(raw.calendarIds) ? raw.calendarIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  const known = knownIds ? new Set(knownIds) : null;
  return {
    enabled: raw.enabled === true,
    calendarIds: [...new Set(known ? ids.filter((id) => known.has(id)) : ids)],
    hideDeclined: raw.hideDeclined !== false,
    weekStart: raw.weekStart === "sunday" ? "sunday" : "monday",
    workStart: validRange ? workStart : DEFAULT_CALENDAR_PREFS.workStart,
    workEnd: validRange ? workEnd : DEFAULT_CALENDAR_PREFS.workEnd,
  };
}

/** Apply a validated patch to current prefs. */
export function applyCalendarPatch(prefs: CalendarPrefs, patch: CalendarPrefsPatch): CalendarPrefs {
  const next: CalendarPrefs = {
    enabled: patch.enabled ?? prefs.enabled,
    calendarIds: patch.calendarIds ? [...new Set(patch.calendarIds)] : prefs.calendarIds,
    hideDeclined: patch.hideDeclined ?? prefs.hideDeclined,
    weekStart: patch.weekStart ?? prefs.weekStart,
    workStart: patch.workStart ?? prefs.workStart,
    workEnd: patch.workEnd ?? prefs.workEnd,
  };
  // An inverted range is not a working day: keep the old one.
  if (!(next.workStart < next.workEnd)) return { ...next, workStart: prefs.workStart, workEnd: prefs.workEnd };
  return next;
}

/**
 * The default choice when calendars are first connected: every calendar except
 * subscribed holiday and birthday ones (CALENDAR-SPEC §3.1).
 */
export function defaultCalendarIds(calendars: readonly { id: string; subscribed: boolean; birthday: boolean }[]): string[] {
  return calendars.filter((c) => !c.birthday && !c.subscribed).map((c) => c.id);
}
