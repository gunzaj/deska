// Field change history (IMPROVEMENTS F0): the shapes shared by the Postgres
// and in-memory stores.
/**
 * `prune` and `restore` are not field changes: a project scan that missed an
 * item deletes it from the cache (`prune`), and when the item comes back its
 * values are written as `restore`. Readers of the history ignore both, so a
 * scan's mistake never reads as scope added to a Release (v5 1.4).
 */
export type ChangeSource = "sync" | "deska" | "prune" | "restore";
/** How long after a prune an item coming back still counts as a restore, not a real add. */
export const RESTORE_WINDOW_MS = 24 * 3600_000;
/** Sources that are bookkeeping, not changes anyone made. */
export const BOOKKEEPING_SOURCES: ChangeSource[] = ["prune", "restore"];
/**
 * `scanId` marks a project scan: the batch path records the page's seen
 * items inside the page transaction, so a crash can't leave the scan's seen list
 * out of step with the items it just wrote (IMPROVEMENTS-2 F6).
 */
export type ImportOptions = { source?: ChangeSource; scanId?: string };

/** The project fields we watch, by the logical name stored in issue_field_changes. */
export const ITEM_FIELD_PROPS = [
  ["status", "statusOpt"],
  ["priority", "priorityOpt"],
  ["team", "teamOpt"],
  ["platform", "platformOpt"],
  ["release", "releaseIter"],
] as const;

export type TrackedField = (typeof ITEM_FIELD_PROPS)[number][0] | "state" | "labels" | "assignees" | "item";

export type FieldChange = {
  issueNodeId: string;
  field: TrackedField;
  oldValue: string | null;
  newValue: string | null;
  observedAt: string;
  source: ChangeSource;
};

/** A label or assignee set as one comparable string: a sorted JSON array of IDs. */
export function setValue(ids: Iterable<string>): string {
  return JSON.stringify([...new Set(ids)].sort());
}

export function parseSetValue(v: string | null): string[] {
  if (!v) return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}
