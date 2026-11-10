// Optimistic edits to one issue as a stack of edits (W2), not one merged patch.
// Two edits in flight on one issue (add label X, then label Y; or Status A→B,
// then B→C) each keep their own layer: a failed edit removes only its own
// layer, and a finished one moves only itself into the base, so a newer edit
// still in flight stays on top. Pure, so it's unit-tested without React.
import { applyWire, wirePatch, type EditField } from "./edit";
import type { WireIssue } from "./types";

export type OverlayEdit = { id: string; field: EditField; next: unknown };

/**
 * One issue's pending edits. `base` holds, for every wire key an edit
 * touched, the value before any of them (a missing key is absent there too):
 * the edits are re-applied in order on top of it.
 */
export type IssueOverlay = { base: Partial<WireIssue>; edits: OverlayEdit[] };

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Run the edits over `start` (only the keys they touch matter). */
function run(start: Partial<WireIssue>, edits: readonly OverlayEdit[]): Partial<WireIssue> {
  let w = start;
  for (const e of edits) w = applyWire(w as WireIssue, wirePatch(w as WireIssue, e.field, e.next));
  return w;
}

/** The keys over the base: every touched key, `undefined` where the field ends up empty. */
export function composed(o: IssueOverlay): Partial<WireIssue> {
  const w = run(o.base, o.edits) as Record<string, unknown>;
  return Object.fromEntries(Object.keys(o.base).map((k) => [k, w[k]])) as Partial<WireIssue>;
}

/** The touched wire keys (to clear the overlay once the stack is empty). */
export const overlayKeys = (o: IssueOverlay | undefined): string[] => (o ? Object.keys(o.base) : []);

/**
 * Push an edit. `shown` is the row as on screen: for keys no pending edit
 * touched yet it equals the loaded row, so that is where their base comes from.
 */
export function pushEdit(o: IssueOverlay | undefined, shown: WireIssue, edit: OverlayEdit): IssueOverlay {
  const base = { ...(o?.base ?? {}) } as Record<string, unknown>;
  for (const k of Object.keys(wirePatch(shown, edit.field, edit.next))) {
    if (!has(base, k)) base[k] = (shown as unknown as Record<string, unknown>)[k];
  }
  return { base: base as Partial<WireIssue>, edits: [...(o?.edits ?? []), edit] };
}

/** Roll one edit back: the others stay. Undefined when nothing is left. */
export function dropEdit(o: IssueOverlay | undefined, id: string): IssueOverlay | undefined {
  if (!o) return undefined;
  const edits = o.edits.filter((e) => e.id !== id);
  return edits.length ? { base: o.base, edits } : undefined;
}

/**
 * One edit was written: it moves into the base (under the edits still in
 * flight). `committed` is that edit alone over the base, for the loaded row.
 */
export function settleEdit(o: IssueOverlay | undefined, id: string): { overlay: IssueOverlay | undefined; committed: Partial<WireIssue> | null } {
  const e = o?.edits.find((x) => x.id === id);
  if (!o || !e) return { overlay: o, committed: null };
  const committed = wirePatch(o.base as WireIssue, e.field, e.next);
  const base = { ...o.base, ...committed };
  const edits = o.edits.filter((x) => x.id !== id);
  return { overlay: edits.length ? { base, edits } : undefined, committed };
}
