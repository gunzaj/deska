// The count behind the Today badge (SPEC §4.6): open tasks that are overdue or
// due today, sub-tasks included, archived projects left out. The sidebar and
// the Dock badge both use this one definition, so they cannot disagree.
import type { Task, TaskProject } from "./model";

export function dueCount(tasks: readonly Pick<Task, "completedAt" | "projectId" | "dueDate">[], projects: readonly Pick<TaskProject, "id" | "archived">[], today: string): number {
  const archived = new Set(projects.filter((p) => p.archived).map((p) => p.id));
  let n = 0;
  for (const t of tasks) {
    if (t.completedAt || (t.projectId && archived.has(t.projectId))) continue;
    if (t.dueDate && t.dueDate <= today) n++;
  }
  return n;
}

/**
 * The sidebar's task counts. Sub-tasks are not counted in a project: its page
 * lists top-level tasks only, so the count must match the rows (T-8). The
 * Inbox count follows the same rule.
 */
export function sidebarCounts(
  tasks: readonly Pick<Task, "completedAt" | "projectId" | "parentId" | "dueDate" | "labels">[],
  projects: readonly Pick<TaskProject, "id" | "archived">[],
  today: string,
): { inbox: number; due: number; perProject: Map<string, number>; perLabel: Map<string, number> } {
  const archived = new Set(projects.filter((p) => p.archived).map((p) => p.id));
  let inbox = 0;
  const perProject = new Map<string, number>();
  const perLabel = new Map<string, number>();
  for (const t of tasks) {
    if (t.completedAt || (t.projectId && archived.has(t.projectId))) continue;
    for (const id of t.labels) perLabel.set(id, (perLabel.get(id) ?? 0) + 1);
    if (t.parentId) continue;
    if (t.projectId) perProject.set(t.projectId, (perProject.get(t.projectId) ?? 0) + 1);
    else inbox++;
  }
  return { inbox, due: dueCount(tasks, projects, today), perProject, perLabel };
}
