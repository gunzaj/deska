// Saved task views (item 12): a named combination of the task filters the
// Tasks pages have — project, label, priority and a due window. Local, like the
// issue views; the strict schema also guards a backup or an import.
import { z } from "zod";
import { addDays } from "./dates";
import type { Task } from "./model";

export const TASK_VIEW_LIMITS = { name: 120, id: 100, filterId: 100 } as const;

/** Due windows a task view can choose. `any` = no restriction. */
export const TASK_DUE_WINDOWS = ["any", "overdue", "today", "upcoming", "none"] as const;
export type TaskDueWindow = (typeof TASK_DUE_WINDOWS)[number];

export const taskViewSchema = z
  .object({
    id: z.string().max(TASK_VIEW_LIMITS.id),
    kind: z.literal("tasks"),
    name: z.string().trim().min(1).max(TASK_VIEW_LIMITS.name),
    filter: z
      .object({
        /** A project ID, `none` for Inbox (tasks with no project), or absent for any project. */
        projectId: z.string().max(TASK_VIEW_LIMITS.filterId).optional(),
        labelId: z.string().max(TASK_VIEW_LIMITS.filterId).optional(),
        priority: z.number().int().min(1).max(4).optional(),
        due: z.enum(TASK_DUE_WINDOWS).optional(),
      })
      .strict(),
  })
  .strict();

export type TaskView = z.infer<typeof taskViewSchema>;
export type TaskViewFilter = TaskView["filter"];
/** A view the client asks to save: the server makes the ID of a new one. */
export type TaskViewDraft = Omit<TaskView, "id" | "kind"> & { id?: string; kind?: "tasks" };

/** Whether a task matches a saved view's filters, on the viewer's calendar day. */
export function taskViewMatches(t: Task, filter: TaskViewFilter, today: string): boolean {
  if (filter.projectId !== undefined) {
    if (filter.projectId === "none" ? t.projectId != null : t.projectId !== filter.projectId) return false;
  }
  if (filter.labelId !== undefined && !t.labels.includes(filter.labelId)) return false;
  if (filter.priority !== undefined && t.priority !== filter.priority) return false;
  switch (filter.due ?? "any") {
    case "overdue":
      return t.dueDate != null && t.dueDate < today;
    case "today":
      return t.dueDate === today;
    case "upcoming":
      return t.dueDate != null && t.dueDate >= today && t.dueDate < addDays(today, 14);
    case "none":
      return t.dueDate == null;
    default:
      return true;
  }
}

/** The "New task" prefill a view implies: its project, when it names one. */
export function taskViewPrefill(filter: TaskViewFilter): { projectId: string | null } {
  const id = filter.projectId;
  return { projectId: id && id !== "none" ? id : null };
}
