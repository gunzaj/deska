// The patch that undoes a Tidy Inbox edit: only the fields the patch touched.
// A due date the server re-pinned the day of the month from needs its old
// rule too, or Undo would bring the date back without the rule.
import type { PatchTaskInput, Task, TaskLabel } from "./model";

export function undoPatchOf(task: Task, patch: PatchTaskInput, labels: TaskLabel[]): PatchTaskInput {
  const undo: PatchTaskInput = {};
  if (patch.title !== undefined) undo.title = task.title;
  if (patch.dueDate !== undefined) {
    undo.dueDate = task.dueDate;
    undo.dueTime = task.dueTime;
    // The server follows a moved date with a pinned day of the month.
    if (patch.recurrence === undefined) undo.recurrence = task.recurrence;
  }
  if (patch.recurrence !== undefined) undo.recurrence = task.recurrence;
  if (patch.priority !== undefined) undo.priority = task.priority;
  if (patch.projectId !== undefined) {
    undo.projectId = task.projectId;
    undo.sectionId = task.sectionId;
  } else if (patch.sectionId !== undefined) {
    undo.sectionId = task.sectionId;
  }
  if (patch.labels !== undefined) undo.labels = task.labels.flatMap((id) => labels.find((l) => l.id === id)?.name ?? []);
  if (patch.links !== undefined) undo.links = task.links.map((l) => l.number);
  return undo;
}

