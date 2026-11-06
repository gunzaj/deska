import type { ReadModel } from "../sync/read-model";
import type { ViewRow } from "../views/rows";

export type BoardColumn = { optionId: string | null; name: string; cards: ViewRow[] };

/** Board columns follow GitHub's option order; unknown/empty values group last. */
export function buildBoard(
  rows: ViewRow[],
  store: ReadModel,
  boardField: "status" | "priority" | "team" | "platform" = "status",
): BoardColumn[] {
  const ref = store.projectFieldMap()[boardField];
  const def = ref ? store.fields.get(ref.id) : undefined;
  const order = (def?.options ?? []).map((o) => ({ id: o.id, name: o.name }));
  const colOf = (r: ViewRow): string | null => {
    switch (boardField) {
      case "status":
        return r.statusId;
      case "priority":
        return r.priorityId;
      case "team":
        return r.teamId;
      case "platform":
        return r.platformId;
    }
  };
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
  | { field: "status" | "priority" | "team" | "platform"; next: string }
  | { field: "release"; next: string };

/**
 * Dragging a card onto a column sets that field; dragging a backlog card
 * (no release) onto the board sets its Release — all through the outbox.
 */
export function moveCard(
  row: ViewRow,
  target: { columnOptionId: string | null; boardField: "status" | "priority" | "team" | "platform" },
  releaseId: string | null,
): MoveDescriptor | null {
  if (row.releaseId == null && releaseId) {
    return { field: "release", next: releaseId };
  }
  if (target.columnOptionId == null) return null;
  const current =
    target.boardField === "status" ? row.statusId
    : target.boardField === "priority" ? row.priorityId
    : target.boardField === "team" ? row.teamId
    : row.platformId;
  if (current === target.columnOptionId) return null;
  return { field: target.boardField, next: target.columnOptionId };
}
