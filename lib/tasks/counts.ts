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
