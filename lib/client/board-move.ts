// What dropping a card in another board column means (IMPROVEMENTS W3).
import { isDimKey } from "../sync/field-map";
import type { EditField } from "./edit";
import type { BoardField } from "./explorer";
import type { ClientIssue } from "./types";

/** The key boardColumns() gives the "No value" column. */
export const NO_VALUE = "∅";

/**
 * The edit for moving `issue` from column `fromKey` to `toKey` on a board of
 * `field`, or null when nothing changes. Assignee columns move one person:
 * the one whose column the card left (dropping on "Unassigned" removes all).
 */
export function boardMove(issue: ClientIssue, field: BoardField, fromKey: string, toKey: string): { field: EditField; next: unknown } | null {
  if (fromKey === toKey) return null;
  if (isDimKey(field)) return { field, next: toKey === NO_VALUE ? null : toKey };
  switch (field) {
    case "status":
    case "priority":
    case "release":
    case "type":
      return { field, next: toKey === NO_VALUE ? null : toKey };
    case "assignee": {
      const login = (key: string) => issue.assignees.find((a) => a.toLowerCase() === key) ?? key;
      if (toKey === NO_VALUE) return issue.assignees.length ? { field: "assignees", next: { added: [], removed: [...issue.assignees] } } : null;
      return { field: "assignees", next: { added: [toKey], removed: fromKey === NO_VALUE ? [] : [login(fromKey)] } };
    }
    default:
      return null;
  }
}

/** Board fields a drag can write; others (none today) would stay read-only. */
export function draggable(field: BoardField): boolean {
  return isDimKey(field) || ["status", "priority", "release", "type", "assignee"].includes(field);
}

/**
 * The drag id of one card. An issue with several assignees has a card in each
 * assignee's column; dnd-kit keys draggables by id, so a shared id let the last
 * card registered stand in for all of them and the drag left the wrong column.
 * Backlog cards (no column) keep their prefix.
 */
export function cardDragId(nodeId: string, colKey: string | null, prefix = ""): string {
  return colKey == null ? `${prefix}${nodeId}` : `${prefix}${colKey}\u001f${nodeId}`;
}
