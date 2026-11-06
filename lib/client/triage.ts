// Triage mode (IMPROVEMENTS F3): pure helpers shared by the queues and the walk-through.
import type { ClientIssue, ClientMeta } from "./types";

/** Snoozed until `until` (YYYY-MM-DD): out of the queues before that day, back on it. */
export function isSnoozed(until: string | undefined, today: string): boolean {
  return until !== undefined && until > today;
}

export function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The snooze choices, as dates from the viewer's today. */
export function snoozePresets(today: string): { label: string; until: string }[] {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const toMonday = ((8 - dow) % 7) || 7;
  return [
    { label: "Tomorrow", until: addDaysIso(today, 1) },
    { label: "In 3 days", until: addDaysIso(today, 3) },
    { label: "Next Monday", until: addDaysIso(today, toMonday) },
    { label: "In 2 weeks", until: addDaysIso(today, 14) },
  ];
}

/** The Priority options from highest to lowest: key 1 is the highest (the field's last option has the top rank). */
export function priorityByKey(meta: Pick<ClientMeta, "fields">): { id: string; name: string }[] {
  return [...meta.fields.priority].reverse().slice(0, 4);
}

/** Issues not snoozed today, in the given order. */
export function withoutSnoozed<T extends Pick<ClientIssue, "nodeId">>(rows: T[], snoozes: ReadonlyMap<string, string>, today: string): T[] {
  return rows.filter((r) => !isSnoozed(snoozes.get(r.nodeId), today));
}
