import { canSee, type Task } from "@/lib/tasks/model";
import type { ClientPr } from "./types";
import { scoreIssue } from "./search";

/** The issues "New issue" opens on GitHub: built from the configured repo, never hardcoded. */
export function newIssueUrl(repo: string): string {
  return `https://github.com/${repo}/issues/new`;
}

/** Palette search over PRs: the issue scoring (#number, title words), PR state mapped on. */
export function searchPrs(prs: ClientPr[], query: string, limit = 5, now = Date.now()): ClientPr[] {
  const scored: { p: ClientPr; s: number }[] = [];
  for (const p of prs) {
    const s = scoreIssue({ number: p.number, title: p.title, state: p.state === "open" ? "open" : "closed", updatedAt: p.updatedAt, labelNames: [] }, query, now);
    if (s >= 0) scored.push({ p, s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.p);
}

/**
 * Palette search over tasks: title only. Only tasks the viewer can see are
 * ever candidates, whatever the store holds (§12.2).
 */
export function searchTasks(tasks: Task[], query: string, viewer: string, limit = 5): Task[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return tasks
    .filter((t) => canSee(t, viewer))
    .filter((t) => {
      const title = t.title.toLowerCase();
      return words.every((w) => title.includes(w));
    })
    .sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)))
    .slice(0, limit);
}
