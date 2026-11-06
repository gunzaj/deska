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
