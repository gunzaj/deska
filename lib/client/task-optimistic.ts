// What an edit looks like in the browser before the server answers. Pure, so the
// rules are unit-tested; the store applies the result and rolls it back.
import type { PatchTaskInput, Reminder, Task, TaskLabel, TaskLink } from "../tasks/model";

const sameReminder = (a: Reminder, b: NonNullable<PatchTaskInput["reminders"]>[number]) =>
  a.kind === b.kind && (a.kind === "relative" ? a.offsetMin === (b as { offsetMin: number }).offsetMin : Date.parse(a.at) === Date.parse((b as { at: string }).at));

/**
 * The fields of `task` that `patch` changes, as the server will most likely
 * set them. The label, link and reminder lists are included, so a second quick
 * edit builds on the first one instead of on the list from before it (T-4).
 * Anything the browser can't know (a brand-new label's ID, a link's node ID)
 * gets a placeholder that the server's answer replaces.
 */
export function optimisticFields(task: Task, patch: PatchTaskInput, labels: readonly TaskLabel[]): Partial<Task> {
  const o: Partial<Task> = {};
  if (patch.title !== undefined) o.title = patch.title;
  if (patch.description !== undefined) o.description = patch.description;
  if (patch.priority !== undefined) o.priority = patch.priority;
  if (patch.dueDate !== undefined) o.dueDate = patch.dueDate;
  if (patch.dueTime !== undefined) o.dueTime = patch.dueTime;
  // No date, no time or recurrence (the server does the same).
  if (patch.dueDate === null) Object.assign(o, { dueTime: null, recurrence: null });
  if (patch.recurrence !== undefined) o.recurrence = patch.recurrence;
  if (patch.projectId !== undefined) o.projectId = patch.projectId;
  // Another project drops the old section, unless the patch names one (the server does the same).
  if (patch.sectionId !== undefined) o.sectionId = patch.sectionId;
  else if (patch.projectId !== undefined && patch.projectId !== task.projectId) o.sectionId = null;
  if (patch.position !== undefined) o.position = patch.position;
  if (patch.labels !== undefined) {
    const byName = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
    o.labels = [...new Set(patch.labels.map((n) => byName.get(n.toLowerCase()) ?? `pending:${n.toLowerCase()}`))];
  }
  if (patch.links !== undefined) {
    const known = new Map(task.links.map((l) => [l.number, l]));
    o.links = patch.links.map((n): TaskLink => known.get(n) ?? { kind: "issue", nodeId: `pending:${n}`, number: n });
  }
  if (patch.reminders !== undefined) {
    const spare = [...task.reminders];
    o.reminders = patch.reminders.map((r, i): Reminder => {
      const at = spare.findIndex((x) => sameReminder(x, r));
      if (at >= 0) return spare.splice(at, 1)[0]!;
      return r.kind === "relative" ? { id: `pending:${i}`, kind: "relative", offsetMin: r.offsetMin } : { id: `pending:${i}`, kind: "absolute", at: r.at };
    });
  }
  return o;
}

/** A label's name for display and editing; an ID the browser made up for a new label carries its name. */
export function labelNameOf(id: string, labels: readonly TaskLabel[]): string | undefined {
  return id.startsWith("pending:") ? id.slice("pending:".length) : labels.find((l) => l.id === id)?.name;
}

/**
 * The list after the server's copy of a task arrives. A task that isn't in the
 * list is added only for a create or restore (`insert`): a late answer for one
 * deleted meanwhile must not bring it back (T-15). An older copy never replaces
 * a newer one.
 */
export function mergeServerTask(prev: Task[], task: Task, insert: boolean): Task[] {
  const cur = prev.find((t) => t.id === task.id);
  if (!cur) return insert ? [...prev, task] : prev;
  if (cur.updatedAt > task.updatedAt) return prev;
  return prev.map((t) => (t.id === task.id ? task : t));
}
