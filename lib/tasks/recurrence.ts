// Recurring due dates (SPEC §12.5): the RRULE subset quick add produces —
// FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with INTERVAL, BYDAY and BYMONTHDAY.
import { addDays, addMonths, weekday } from "./dates";

export type Rule = { freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"; interval: number; byDay: number[]; byMonthDay: number | null };

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function parseRule(rule: string): Rule | null {
  const parts = new Map(
    rule.split(";").map((p) => {
      const [k = "", v = ""] = p.split("=");
      return [k.toUpperCase(), v.toUpperCase()] as const;
    }),
  );
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;
  const interval = Number(parts.get("INTERVAL") ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) return null;
  const byDay = (parts.get("BYDAY") ?? "")
    .split(",")
    .filter(Boolean)
    .map((d) => DAYS.indexOf(d));
  if (byDay.some((d) => d < 0)) return null;
  const md = parts.get("BYMONTHDAY");
  const byMonthDay = md ? Number(md) : null;
  if (byMonthDay != null && (!Number.isInteger(byMonthDay) || byMonthDay < 1 || byMonthDay > 31)) return null;
  return { freq, interval, byDay, byMonthDay };
}

export function isValidRule(rule: string): boolean {
  return parseRule(rule) != null;
}

/**
 * A bare FREQ=MONTHLY steps from the current due date, so a start on the
 * 29th–31st drifts once a short month clamps it (Jan 31 → Feb 28 → Mar 28).
 * FREQ=YEARLY drifts the same way from 29 Feb (2028 → 2029-02-28, then the
 * 28th for good). Pin the first due date's day instead. `every!` counts from each completion
 * and has no day to keep.
 */
export function pinMonthDay<R extends { rule: string; fromCompletion: boolean }>(r: R, firstDate: string): R {
  const p = parseRule(r.rule);
  const day = Number(firstDate.slice(8, 10));
  if (!p || (p.freq !== "MONTHLY" && p.freq !== "YEARLY") || p.byMonthDay != null || r.fromCompletion || day <= 28) return r;
  return { ...r, rule: `${r.rule};BYMONTHDAY=${day}` };
}

function monthDay(date: string, day: number): string {
  const [y = 0, m = 1] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
}

/**
 * The next due date strictly after `base`. With `every` the base is the
 * current due date (the schedule); with `every!` it is the completion day.
 */
export function nextOccurrence(rule: string, base: string): string | null {
  const r = parseRule(rule);
  if (!r) return null;
  switch (r.freq) {
    case "DAILY":
      return addDays(base, r.interval);
    case "WEEKLY": {
      if (!r.byDay.length) return addDays(base, 7 * r.interval);
      // Next listed weekday after base, in this week or a later one.
      for (let i = 1; i <= 7; i++) {
        const d = addDays(base, i);
        if (!r.byDay.includes(weekday(d))) continue;
        // Crossing into a new week (Monday start) skips interval-1 weeks.
        const crossed = (weekday(base) + 6) % 7 >= (weekday(d) + 6) % 7;
        return crossed && r.interval > 1 ? addDays(d, 7 * (r.interval - 1)) : d;
      }
      return null;
    }
    case "MONTHLY": {
      if (r.byMonthDay == null) return addMonths(base, r.interval);
      const sameMonth = monthDay(base, r.byMonthDay);
      if (sameMonth > base && r.interval === 1) return sameMonth;
      return monthDay(addMonths(`${base.slice(0, 8)}01`, r.interval), r.byMonthDay);
    }
    case "YEARLY": {
      // Keep the pinned day (29 Feb comes back in a leap year); the month is the base's.
      const target = addMonths(`${base.slice(0, 8)}01`, 12 * r.interval);
      return monthDay(target, r.byMonthDay ?? Number(base.slice(8, 10)));
    }
  }
}

/** The RRULE for a rule built in the repeat picker. Weekdays are written Monday first. */
export function formatRule(r: Rule): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === "WEEKLY" && r.byDay.length) parts.push(`BYDAY=${mondayFirst(r.byDay).map((d) => DAYS[d]).join(",")}`);
  if (r.freq === "MONTHLY" && r.byMonthDay != null) parts.push(`BYMONTHDAY=${r.byMonthDay}`);
  return parts.join(";");
}

function mondayFirst(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/**
 * Plain-words label for a rule, in quick add's lowercase style:
 * "every weekday", "every 2 weeks on tue, fri", "every month on the 13th".
 */
export function describeRule(rule: string, fromCompletion = false): string | null {
  const r = parseRule(rule);
  if (!r) return null;
  const n = r.interval;
  const every = (unit: string) => (n === 1 ? `every ${unit}` : `every ${n} ${unit}s`);
  let text: string;
  switch (r.freq) {
    case "DAILY":
      text = every("day");
      break;
    case "WEEKLY": {
      const days = mondayFirst(r.byDay);
      if (!days.length) text = every("week");
      else if (n === 1 && days.length === 7) text = "every day";
      else if (n === 1 && days.join() === "1,2,3,4,5") text = "every weekday";
      else {
        const names = days.length === 1 ? DAY_NAMES[days[0]!]! : days.map((d) => DAY_NAMES[d]!.slice(0, 3)).join(", ");
        text = n === 1 ? `every ${names}` : `every ${n} weeks on ${names}`;
      }
      break;
    }
    case "MONTHLY":
      text = every("month");
      // monthDay() clamps, so the 31st is the last day of every month.
      if (r.byMonthDay != null) text += r.byMonthDay === 31 ? " on the last day" : ` on the ${ordinal(r.byMonthDay)}`;
      break;
    case "YEARLY":
      text = every("year");
      break;
  }
  return fromCompletion ? `${text} after completion` : text;
}

/**
 * The first due date of a rule on or after `from`: `from` itself unless the
 * rule names weekdays or a day of the month that it isn't. The interval only
 * spaces later occurrences, so it doesn't push the first one out.
 */
export function firstOccurrence(rule: string, from: string): string {
  const r = parseRule(rule);
  if (r?.freq === "WEEKLY" && r.byDay.length) {
    for (let i = 0; i < 7; i++) {
      const d = addDays(from, i);
      if (r.byDay.includes(weekday(d))) return d;
    }
  }
  if (r?.freq === "MONTHLY" && r.byMonthDay != null) {
    const same = monthDay(from, r.byMonthDay);
    return same >= from ? same : monthDay(addMonths(`${from.slice(0, 8)}01`, 1), r.byMonthDay);
  }
  return from;
}
