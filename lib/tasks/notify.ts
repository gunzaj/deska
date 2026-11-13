// Reminders and notifications (SPEC §12.6). Reminders become `notifications`
// rows lazily: when the viewer's client polls (app/api/notifications).
// The dedupe key makes each reminder occurrence fire exactly once.
import { addDays, zonedToUtc } from "./dates";
import { LOCAL_OWNER } from "../local-owner";
import type { TaskCore } from "./model";
import { taskRepo } from "./repo";

/** Fire reminders up to this far in the past (e.g. the tab was closed). */
export const CATCH_UP_MS = 24 * 60 * 60_000;
/** All-day tasks have no time; relative reminders count back from this. */
export const DEFAULT_REMINDER_TIME = "09:00";

/**
 * Every reminder instant for the task's current occurrence. A timed task
 * reminds at its due time; an all-day task only through explicit reminders
 * (Q5). Keys include the due date, so a recurring task reminds again for
 * each occurrence.
 */
/** `legacyKey`: the key older versions used for a one-off task's absolute reminder. */
export function reminderTimes(t: TaskCore): { key: string; at: Date; legacyKey?: string }[] {
  const out: { key: string; at: Date; legacyKey?: string }[] = [];
  const tz = t.dueTz ?? "UTC";
  const occurrence = `${t.dueDate ?? "nodate"}T${t.dueTime ?? "allday"}`;
  if (t.dueDate && t.dueTime) out.push({ key: `due:${occurrence}`, at: zonedToUtc(t.dueDate, t.dueTime, tz) });
  for (const r of t.reminders) {
    // The instant is part of the key whether or not the task recurs, so making a
    // task recurring (or the reverse) doesn't change it and re-fire the last 24 h.
    // A one-off task's reminder used to be keyed by its ID alone: `fireReminders`
    // treats that old key as fired when it was created at or after the instant.
    if (r.kind === "absolute") out.push({ key: `abs:${r.id}:${Date.parse(r.at)}`, legacyKey: `abs:${r.id}`, at: new Date(r.at) });
    else if (t.dueDate) {
      const base = zonedToUtc(t.dueDate, t.dueTime ?? DEFAULT_REMINDER_TIME, tz);
      out.push({ key: `rel:${r.id}:${occurrence}`, at: new Date(base.getTime() - r.offsetMin * 60_000) });
    }
  }
  return out;
}

/** Turn due reminders into notifications for `login`, the local owner. Returns how many fired. */
export async function fireReminders(now = new Date(), login: string = LOCAL_OWNER): Promise<number> {
  const repo = taskRepo();
  const since = new Date(now.getTime() - CATCH_UP_MS);
  const today = now.toISOString().slice(0, 10);
  // Wide enough for any zone and the longest relative reminder (14 days).
  const candidates = await repo.reminderCandidates(addDays(today, -2), addDays(today, 15), since, now);
  let fired = 0;
  for (const t of candidates) {
    for (const r of reminderTimes(t)) {
      // Only reminders that came due after the task existed, within catch-up.
      if (r.at > now || r.at <= since || r.at.getTime() <= Date.parse(t.createdAt)) continue;
      if (r.legacyKey) {
        const old = await repo.notificationAt(`rem:${t.id}:${r.legacyKey}`);
        if (old && Date.parse(old) >= r.at.getTime()) continue;
      }
      const added = await repo.addNotification({ login, kind: "reminder", taskId: t.id, title: t.title, dedupeKey: `rem:${t.id}:${r.key}` });
      if (added) fired++;
    }
  }
  return fired;
}
