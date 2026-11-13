// Dragging a task onto the sidebar (a view or a project) files or reschedules
// it. Pure, so what a drop means is unit-tested.
import { addDays } from "../tasks/dates";
import type { Task } from "../tasks/model";

export const TASK_DRAG_TYPE = "application/x-deska-task";

export type DropTarget =
  | { kind: "inbox" }
  | { kind: "today" }
  | { kind: "upcoming" }
  | { kind: "project"; id: string; name: string }
  | { kind: "label"; name: string };

type Patch = { projectId?: string | null; sectionId?: string | null; position?: number; dueDate?: string | null; labels?: string[] };

export type DropResult = { patch: Patch; undo: Patch; message: string } | null;

// Where the task is filed now: the server clears the section on a project change
// and appends at the end, so Undo must name all three.
const filedAs = (t: Pick<Task, "projectId" | "sectionId" | "position">): Patch => ({ projectId: t.projectId, sectionId: t.sectionId, position: t.position });

/**
 * What dropping `task` on `target` does, with the patch that undoes it, or null
 * when it would change nothing. `labelNames` are the task's own label names.
 */
export function dropOutcome(task: Pick<Task, "projectId" | "dueDate" | "sectionId" | "position">, labelNames: string[], target: DropTarget, today: string): DropResult {
  switch (target.kind) {
    case "inbox":
      return task.projectId === null ? null : { patch: { projectId: null }, undo: filedAs(task), message: "Moved to Inbox" };
    case "project":
      return task.projectId === target.id ? null : { patch: { projectId: target.id }, undo: filedAs(task), message: `Moved to ${target.name}` };
    case "today":
      return task.dueDate === today ? null : { patch: { dueDate: today }, undo: { dueDate: task.dueDate }, message: "Due today" };
    case "upcoming": {
      // Already scheduled for a later day: leave it where it is.
      if (task.dueDate && task.dueDate > today) return null;
      const tomorrow = addDays(today, 1);
      return { patch: { dueDate: tomorrow }, undo: { dueDate: task.dueDate }, message: "Due tomorrow" };
    }
    case "label":
      return labelNames.some((n) => n.toLowerCase() === target.name.toLowerCase())
        ? null
        : { patch: { labels: [...labelNames, target.name] }, undo: { labels: labelNames }, message: `Labelled ${target.name}` };
  }
}
