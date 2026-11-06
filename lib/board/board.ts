import { dimFieldId, isDimKey } from "../sync/field-map";
import type { ReadModel } from "../sync/read-model";
import type { ViewRow } from "../views/rows";

export type BoardColumn = { optionId: string | null; name: string; cards: ViewRow[] };

/** A board's column field: Status, Priority or a mapped dimension (`dim:<fieldId>`). */
export type BoardSelectField = "status" | "priority" | `dim:${string}`;

/** The row's value for a board field. */
function valueOf(r: ViewRow, field: BoardSelectField): string | null {
  if (isDimKey(field)) return r.dims[dimFieldId(field)]?.id ?? null;
  return field === "status" ? r.statusId : r.priorityId;
}

/** Board columns follow GitHub's option order; unknown/empty values group last. */
export function buildBoard(
  rows: ViewRow[],
  store: ReadModel,
  boardField: BoardSelectField = "status",
): BoardColumn[] {
  const map = store.projectFieldMap();
  const ref = isDimKey(boardField) ? map.dimensions.find((d) => d.id === dimFieldId(boardField)) : map[boardField];
  const def = ref ? store.fields.get(ref.id) : undefined;
  const order = (def?.options ?? []).map((o) => ({ id: o.id, name: o.name }));
  const colOf = (r: ViewRow): string | null => valueOf(r, boardField);
  const byId = new Map<string | null, ViewRow[]>();
  for (const r of rows) {
    const k = colOf(r);
    const list = byId.get(k) ?? [];
    list.push(r);
    byId.set(k, list);
  }
  const cols: BoardColumn[] = order.map((o) => ({
    optionId: o.id,
    name: o.name,
    cards: byId.get(o.id) ?? [],
  }));
  const known = new Set(order.map((o) => o.id));
  const rest = [...byId.entries()].filter(([k]) => k !== null && !known.has(k as string));
  for (const [k, cards] of rest) cols.push({ optionId: k, name: k ?? "?", cards });
  if (byId.has(null)) cols.push({ optionId: null, name: "No value", cards: byId.get(null)! });
  return cols;
}

export type MoveDescriptor =
  | { field: BoardSelectField; next: string }
  | { field: "release"; next: string };

/**
 * Dragging a card onto a column sets that field; dragging a backlog card
 * (no release) onto the board sets its Release — all through the outbox.
 */
export function moveCard(
  row: ViewRow,
  target: { columnOptionId: string | null; boardField: BoardSelectField },
  releaseId: string | null,
): MoveDescriptor | null {
  if (row.releaseId == null && releaseId) {
    return { field: "release", next: releaseId };
  }
  if (target.columnOptionId == null) return null;
  const current = valueOf(row, target.boardField);
  if (current === target.columnOptionId) return null;
  return { field: target.boardField, next: target.columnOptionId };
}
