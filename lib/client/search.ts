// Ranking for the command palette's issue search. Pure, so it is unit tested.
import type { ClientIssue } from "./types";

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Score an issue for a query, or -1 when it does not match. Exact #number wins,
 * then number prefix, then title matches (all words required; whole-word and
 * prefix hits rank higher). Open issues and recent activity break ties.
 */
export function scoreIssue(i: Pick<ClientIssue, "number" | "title" | "state" | "updatedAt" | "labelNames">, query: string, now = Date.now()): number {
  const q = normalize(query.trim());
  if (!q) return -1;
  const num = /^#?(\d+)$/.exec(q);
  if (num) {
    const n = String(i.number);
    if (n === num[1]) return 10_000;
    if (n.startsWith(num[1]!)) return 5_000 - n.length;
  }
  const title = normalize(i.title);
  const labels = normalize(i.labelNames.join(" "));
  const words = q.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const w of words) {
    const at = title.indexOf(w);
    if (at === -1) {
      if (labels.includes(w)) {
        score += 5;
        continue;
      }
      return -1;
    }
    const wordStart = at === 0 || /\W/.test(title[at - 1]!);
    score += wordStart ? 30 : 10;
    if (at === 0) score += 20;
  }
  if (title.includes(q) && words.length > 1) score += 40;
  if (i.state === "open") score += 15;
  const ageDays = (now - Date.parse(i.updatedAt)) / 86_400_000;
  score += Math.max(0, 10 - ageDays / 10);
  return score;
}

export function searchIssues<T extends Parameters<typeof scoreIssue>[0]>(issues: T[], query: string, limit = 8, now = Date.now()): T[] {
  const scored: { i: T; s: number }[] = [];
  for (const i of issues) {
    const s = scoreIssue(i, query, now);
    if (s >= 0) scored.push({ i, s });
  }
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.i);
}

/** Plain-text match for palette commands ("go to backlog" matches "backlog"). */
export function matchesCommand(label: string, keywords: string, query: string): boolean {
  const hay = normalize(`${label} ${keywords}`);
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
