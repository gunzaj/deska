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
export function reminderTimes(t: TaskCore): { key: string; at: Date }[] {
  const out: { key: string; at: Date }[] = [];
  const tz = t.dueTz ?? "UTC";
  const occurrence = `${t.dueDate ?? "nodate"}T${t.dueTime ?? "allday"}`;
  if (t.dueDate && t.dueTime) out.push({ key: `due:${occurrence}`, at: zonedToUtc(t.dueDate, t.dueTime, tz) });
  for (const r of t.reminders) {
    // A recurring task's absolute reminder keeps its ID as it moves to each
    // occurrence, so the instant is part of the key: it fires again for the next
    // one, and an undo that moves it back must not fire it again. A one-off
    // task's reminder keeps the old key, so an upgrade doesn't fire one that
    // already fired before it.
    if (r.kind === "absolute") out.push({ key: t.recurrence ? `abs:${r.id}:${Date.parse(r.at)}` : `abs:${r.id}`, at: new Date(r.at) });
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
      const added = await repo.addNotification({ login, kind: "reminder", taskId: t.id, title: t.title, dedupeKey: `rem:${t.id}:${r.key}` });
      if (added) fired++;
    }
  }
  return fired;
}
