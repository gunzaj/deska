// The Completed view (SPEC §4.6, D13): completions grouped by the day they
// happened, in the viewer's time zone. Pure, so the grouping is unit-tested.
import { addDays, localToday } from "../tasks/dates";
import type { CompletedItem } from "../tasks/model";

export type CompletedDay = { day: string; title: string; items: CompletedItem[] };

const pretty = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "Today · Sat 7 Nov", "Yesterday · Fri 6 Nov", then "Thu 5 Nov". */
export function dayTitle(day: string, today: string): string {
  if (day === today) return `Today · ${pretty(day)}`;
  if (day === addDays(today, -1)) return `Yesterday · ${pretty(day)}`;
  return pretty(day);
}

/** Newest day first, newest completion first inside a day. */
export function groupByDay(items: CompletedItem[], tz: string, today: string): CompletedDay[] {
  const days = new Map<string, CompletedItem[]>();
  for (const it of [...items].sort((a, b) => b.at.localeCompare(a.at))) {
    const day = localToday(new Date(it.at), tz);
    days.set(day, [...(days.get(day) ?? []), it]);
  }
  return [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, list]) => ({ day, title: dayTitle(day, today), items: list }));
}
