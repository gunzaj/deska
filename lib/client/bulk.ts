// Bulk edit (IMPROVEMENTS W4): one change applied to many issues, one outbox
// row per issue. Pure, so the per-issue edits and wording are unit-tested.
import { needsBulkConfirm } from "../outbox/queue";
import type { EditField } from "./edit";
import type { ClientIssue } from "./types";

export type BulkSetField = "status" | "priority" | "team" | "platform" | "release";

export type BulkChange =
  | { kind: "set"; field: BulkSetField; value: string | null; valueLabel: string }
  | { kind: "label"; op: "add" | "remove"; id: string; name: string }
  | { kind: "assignee"; op: "add" | "remove"; login: string };

const FIELD_LABEL: Record<BulkSetField, string> = { status: "Status", priority: "Priority", team: "Team", platform: "Platform", release: "Release" };

function current(issue: ClientIssue, field: BulkSetField): string | null {
  return field === "status" ? issue.statusId : field === "priority" ? issue.priorityId : field === "team" ? issue.teamId : field === "platform" ? issue.platformId : issue.releaseId;
}

/** The edit `change` means for one issue, or null when it already holds it. */
export function bulkEdit(issue: ClientIssue, change: BulkChange): { field: EditField; next: unknown } | null {
  switch (change.kind) {
    case "set":
      return current(issue, change.field) === change.value ? null : { field: change.field, next: change.value };
    case "label": {
      const has = issue.labelIds.includes(change.id);
      if (change.op === "add") return has ? null : { field: "labels", next: { added: [change.id], removed: [] } };
      return has ? { field: "labels", next: { added: [], removed: [change.id] } } : null;
    }
    case "assignee": {
      const has = issue.assignees.some((a) => a.toLowerCase() === change.login.toLowerCase());
      if (change.op === "add") return has ? null : { field: "assignees", next: { added: [change.login], removed: [] } };
      return has ? { field: "assignees", next: { added: [], removed: [change.login] } } : null;
    }
  }
}

/** "Set Priority to HIGH", "Add label “ui”", "Unassign bob". */
export function describeChange(change: BulkChange): string {
  switch (change.kind) {
    case "set":
      return change.value == null ? `Clear ${FIELD_LABEL[change.field]}` : `Set ${FIELD_LABEL[change.field]} to ${change.valueLabel}`;
    case "label":
      return `${change.op === "add" ? "Add" : "Remove"} label “${change.name}”`;
    case "assignee":
      return `${change.op === "add" ? "Assign" : "Unassign"} ${change.login}`;
  }
}

/** Over 50 issues needs a confirmation stating the count and the change (SPEC §5). */
export function bulkConfirmText(change: BulkChange, count: number): string | null {
  return needsBulkConfirm(count) ? `${describeChange(change)} on ${count} issues?` : null;
}

/** Issues a Shift+click selects: everything between the anchor and the clicked row, in display order. */
export function rangeIds(order: string[], anchor: string | null, clicked: string): string[] {
  const a = anchor ? order.indexOf(anchor) : -1;
  const b = order.indexOf(clicked);
  if (b < 0) return [];
  if (a < 0) return [clicked];
  const [from, to] = a < b ? [a, b] : [b, a];
  return order.slice(from, to + 1);
}
