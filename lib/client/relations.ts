// Pure helpers for the issue panel's Relationships block: finding an issue to
// link, and which issues can't be linked (itself, or one that would make a loop).
import type { ClientIssue } from "./types";

/**
 * Issues matching what the user typed in an issue picker. `#12` or `12`
 * matches by number prefix; anything else needs every word in the title.
 * With nothing typed, open issues come first, most recently updated first.
 */
export function searchIssues(issues: ClientIssue[], query: string, exclude: ReadonlySet<string>, limit = 50): ClientIssue[] {
  const q = query.trim().toLowerCase();
  const pool = issues.filter((i) => !exclude.has(i.nodeId));
  const num = /^#?(\d+)$/.exec(q);
  let hits: ClientIssue[];
  if (!q) hits = pool;
  else if (num) hits = pool.filter((i) => String(i.number).startsWith(num[1]!));
  else {
    const words = q.split(/\s+/);
    hits = pool.filter((i) => {
      const t = i.title.toLowerCase();
      return words.every((w) => t.includes(w));
    });
  }
  return [...hits]
    .sort((a, b) => {
      if (num) {
        const exact = Number(b.number === Number(num[1])) - Number(a.number === Number(num[1]));
        if (exact) return exact;
      }
      return a.state === b.state ? b.updatedAt.localeCompare(a.updatedAt) : a.state === "open" ? -1 : 1;
    })
    .slice(0, limit);
}

/** The issue and everything below it in the cache: none of them can become its parent. */
export function selfAndDescendants(issues: ClientIssue[], nodeId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const i of issues) if (i.parentNodeId) children.set(i.parentNodeId, [...(children.get(i.parentNodeId) ?? []), i.nodeId]);
  const out = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) {
      if (out.has(c)) continue;
      out.add(c);
      stack.push(c);
    }
  }
  return out;
}

/** The issue and everything above it in the cache: none of them can become its sub-issue. */
export function selfAndAncestors(byNodeId: ReadonlyMap<string, ClientIssue>, nodeId: string): Set<string> {
  const out = new Set<string>([nodeId]);
  let cur = byNodeId.get(nodeId)?.parentNodeId ?? null;
  while (cur && !out.has(cur)) {
    out.add(cur);
    cur = byNodeId.get(cur)?.parentNodeId ?? null;
  }
  return out;
}
