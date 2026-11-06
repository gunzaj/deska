// Issue edits in the browser (IMPROVEMENTS W2): what an edit sends to
// POST /api/issues/[n]/edit and how it changes the compact wire row
// optimistically. Pure, so it's unit-tested without React.
import { dimFieldId, isDimKey } from "../sync/field-map";
import type { ClientIssue, DimKey, WireIssue } from "./types";

/** Fixed fields, and mapped dimensions as `dim:<fieldId>` (§4.1). */
export type EditField = "status" | "priority" | "release" | "type" | "milestone" | "labels" | "assignees" | "state" | DimKey;

export type Delta = { added: string[]; removed: string[] };

/** The request body for one edit. Labels by ID and assignees by login go as deltas. */
export type EditRequest = { field: EditField; base?: unknown; next: unknown; idempotencyKey: string };

const WIRE_KEY: Record<Exclude<EditField, "labels" | "assignees" | "state" | DimKey>, keyof WireIssue> = {
  status: "st",
  priority: "pr",
  release: "rl",
  type: "ty",
  milestone: "ms",
};

/** The issue's current value for a single-value field: the base GitHub must still hold. */
export function currentValue(issue: ClientIssue, field: EditField): string | null {
  if (isDimKey(field)) return issue.dims[dimFieldId(field)]?.id ?? null;
  switch (field) {
    case "status":
      return issue.statusId;
    case "priority":
      return issue.priorityId;
    case "release":
      return issue.releaseId;
    case "type":
      return issue.typeId;
    case "milestone":
      return issue.milestoneId;
    case "state":
      return issue.state;
    default:
      return null;
  }
}

/** The wire keys an edit touches, with their new values (undefined = cleared). */
export function wirePatch(w: WireIssue, field: EditField, next: unknown): Partial<WireIssue> {
  if (field === "state") return { o: next === "open" ? 1 : 0 };
  if (field === "labels" || field === "assignees") {
    const d = next as Delta;
    const key = field === "labels" ? "lb" : "as";
    const same = (a: string, b: string) => (field === "assignees" ? a.toLowerCase() === b.toLowerCase() : a === b);
    const cur = (w[key] ?? []).filter((x) => !d.removed.some((r) => same(x, r)));
    for (const a of d.added) if (!cur.some((x) => same(x, a))) cur.push(a);
    return { [key]: cur.length ? cur : undefined };
  }
  if (isDimKey(field)) {
    const dm = { ...(w.dm ?? {}) };
    if (next == null) delete dm[dimFieldId(field)];
    else dm[dimFieldId(field)] = next as string;
    return { dm: Object.keys(dm).length ? dm : undefined };
  }
  return { [WIRE_KEY[field]]: (next as string | null) ?? undefined };
}

/** The keys' values before the edit, to roll back exactly what the edit changed. */
export function wireBefore(w: WireIssue, patch: Partial<WireIssue>): Partial<WireIssue> {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, w[k as keyof WireIssue]])) as Partial<WireIssue>;
}

/** Apply a partial row, where `undefined` removes the key (an empty field). */
export function applyWire(w: WireIssue, patch: Partial<WireIssue>): WireIssue {
  const out = { ...w } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as WireIssue;
}

export function editRequest(issue: ClientIssue, field: EditField, next: unknown, idempotencyKey: string): EditRequest {
  // Deltas commute and carry no base; everything else says what we saw.
  if (field === "labels" || field === "assignees") return { field, next, idempotencyKey };
  return { field, base: currentValue(issue, field), next, idempotencyKey };
}

export const EDITING_OFF = "Editing is off for this deployment";
