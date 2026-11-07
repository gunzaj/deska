import type { SnapshotIssue } from "../sync/types";

/**
 * Sub-issue counts for a fictional dataset, from its own parent links: what
 * GitHub's `subIssuesSummary` reports for real data (§4.4). Parents only; an
 * issue without children keeps no summary, like an unread one.
 */
export function withSubSummaries(issues: SnapshotIssue[]): SnapshotIssue[] {
  const counts = new Map<string, { total: number; completed: number }>();
  for (const i of issues) {
    if (!i.parentNodeId) continue;
    const c = counts.get(i.parentNodeId) ?? { total: 0, completed: 0 };
    c.total += 1;
    if (i.state === "closed") c.completed += 1;
    counts.set(i.parentNodeId, c);
  }
  return issues.map((i) => {
    const c = counts.get(i.nodeId);
    return c ? { ...i, subTotal: c.total, subCompleted: c.completed } : i;
  });
}
