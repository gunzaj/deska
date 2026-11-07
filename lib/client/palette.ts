import { type Task } from "@/lib/tasks/model";

/** The issues "New issue" opens on GitHub: built from the configured repo, never hardcoded. */
export function newIssueUrl(repo: string): string {
  return `https://github.com/${repo}/issues/new`;
}

/**
 * Palette search over tasks: title only (D13 adds descriptions and comments).
 */
export function searchTasks(tasks: Task[], query: string, limit = 5): Task[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return tasks
    .filter((t) => {
      const title = t.title.toLowerCase();
      return words.every((w) => title.includes(w));
    })
    .sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)))
    .slice(0, limit);
}
