// Rows as the explorer shows them, for j/k, Shift+click ranges, ⌘A and bulk
// edit. Grouped by Label or Assignee (or on an assignee board) one issue
// shows in several places, so a place is keyed by its group and the issue,
// never by the issue alone. Pure, so it's unit-tested without React.
import { rangeIds } from "./bulk";
import type { Group } from "./explorer";
import type { ClientIssue } from "./types";

/** One place an issue shows: `key` is unique in the list, `issue` may repeat. */
export type NavRow = { key: string; issue: ClientIssue };

/** The key of `nodeId` shown in the group (or board column) `groupKey`. */
export const rowKey = (groupKey: string, nodeId: string): string => `${groupKey}\u001f${nodeId}`;

/** A group's collapse key: by field too, so "No status" and "No priority" stay apart after regrouping. */
export const groupId = (g: Pick<Group, "field" | "key">): string => `${g.field}:${g.key}`;

/**
 * The collapsed groups: what the user toggled, else the group's own default
 * (the sprint's "Not planned"). Read on every grouping, so switching to a
 * grouping with a collapsed-by-default group collapses it then too.
 */
export function collapsedGroups(groups: readonly Group[], toggled: Readonly<Record<string, boolean>>): Set<string> {
  const out = new Set<string>();
  for (const g of groups) if (toggled[groupId(g)] ?? !!g.collapsed) out.add(groupId(g));
  return out;
}

/** `toggled` after flipping `g`. */
export function toggleGroup(toggled: Readonly<Record<string, boolean>>, g: Group, collapsed: ReadonlySet<string>): Record<string, boolean> {
  return { ...toggled, [groupId(g)]: !collapsed.has(groupId(g)) };
}

/** The rows a list shows, top to bottom: collapsed groups' rows are not shown, so not reachable. */
export function listNavRows(groups: readonly Group[], collapsed: ReadonlySet<string>): NavRow[] {
  const out: NavRow[] = [];
  for (const g of groups) {
    if (collapsed.has(groupId(g))) continue;
    for (const issue of g.rows) out.push({ key: rowKey(g.key, issue.nodeId), issue });
  }
  return out;
}

/** The cards a board shows, down each column in turn: the first `limit` per column, which "Show more" raises column by column. */
export function boardNavRows(cols: readonly { key: string; rows: ClientIssue[] }[], limit: number | ((columnKey: string) => number)): NavRow[] {
  const limitOf = typeof limit === "number" ? () => limit : limit;
  return cols.flatMap((c) => c.rows.slice(0, limitOf(c.key)).map((issue) => ({ key: rowKey(c.key, issue.nodeId), issue })));
}

/** The focused row's position, or -1. */
export const focusIndex = (rows: readonly { key: string }[], focusedKey: string | null): number => (focusedKey ? rows.findIndex((r) => r.key === focusedKey) : -1);

/** j/k: the next or previous row, clamped; from the first row when nothing is focused. */
export function stepFocus<T extends { key: string }>(rows: readonly T[], focusedKey: string | null, dir: 1 | -1): T | undefined {
  const idx = focusIndex(rows, focusedKey);
  return rows[Math.max(0, Math.min(rows.length - 1, idx < 0 ? 0 : idx + dir))];
}

/** The row to focus for issue `number` (the side panel): the focused one when it is that issue, else its first place. */
export function focusForIssue(rows: readonly NavRow[], focusedKey: string | null, number: number): string | null {
  const cur = rows.find((r) => r.key === focusedKey);
  if (cur?.issue.number === number) return cur.key;
  return rows.find((r) => r.issue.number === number)?.key ?? null;
}

/** Shift+click: the issues between the anchor row and the clicked row, as shown. */
export function rangeNodeIds(rows: readonly NavRow[], anchorKey: string | null, clickedKey: string): string[] {
  const byKey = new Map(rows.map((r) => [r.key, r.issue.nodeId]));
  return [...new Set(rangeIds(rows.map((r) => r.key), anchorKey, clickedKey).map((k) => byKey.get(k)!))];
}

/**
 * The selected issues a bulk edit acts on: only those still shown. A filter,
 * a search or a collapsed group hides rows without dropping them from the
 * selection, so clearing the filter brings the ticks back, but nothing hidden
 * is ever edited.
 */
export function visibleSelection(rows: readonly NavRow[], selected: ReadonlySet<string>): ClientIssue[] {
  const seen = new Set<string>();
  const out: ClientIssue[] = [];
  for (const r of rows) {
    if (!selected.has(r.issue.nodeId) || seen.has(r.issue.nodeId)) continue;
    seen.add(r.issue.nodeId);
    out.push(r.issue);
  }
  return out;
}

/** The distinct issues shown (⌘A). */
export const shownNodeIds = (rows: readonly NavRow[]): string[] => [...new Set(rows.map((r) => r.issue.nodeId))];
