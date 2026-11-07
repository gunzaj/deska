import { type SearchHit, type Task } from "@/lib/tasks/model";

/** The issues "New issue" opens on GitHub: built from the configured repo, never hardcoded. */
export function newIssueUrl(repo: string): string {
  return `https://github.com/${repo}/issues/new`;
}

/**
 * Instant palette search over the tasks the browser holds: title only. The
 * server adds descriptions and comments (`mergeTaskHits`, D13).
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

/**
 * The palette's task rows: title matches from the browser first (instant), then
 * what the server found in descriptions and comments (or in tasks the browser
 * doesn't hold, such as old completed ones), without repeats.
 */
export function mergeTaskHits(local: Task[], remote: SearchHit[], limit = 5): SearchHit[] {
  const out: SearchHit[] = local.map((task) => ({ task, in: "title" as const }));
  const seen = new Set(out.map((h) => h.task.id));
  for (const h of remote) {
    if (seen.has(h.task.id)) continue;
    seen.add(h.task.id);
    out.push(h);
  }
  return out.slice(0, limit);
}
