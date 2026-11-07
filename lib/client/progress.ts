// Parent issue progress (§4.4): GitHub's own sub-issue counts, shown as they are.
// Pure and shared by the rows, the issue panel, the Epics page and the sprint view.

export type SubCounts = { subTotal: number | null; subCompleted: number | null; hasSubIssues: boolean };

export type SubProgress =
  /** No children: show nothing, never 0% or 100%. */
  | { kind: "none" }
  /** Has children in the cache but GitHub's counts haven't been read yet: never a number. */
  | { kind: "unloaded" }
  | { kind: "counted"; total: number; done: number; pct: number };

export function subProgress(i: SubCounts): SubProgress {
  if (i.subTotal == null || i.subCompleted == null) return i.hasSubIssues ? { kind: "unloaded" } : { kind: "none" };
  if (i.subTotal <= 0) return { kind: "none" };
  const done = Math.min(i.subCompleted, i.subTotal);
  return { kind: "counted", total: i.subTotal, done, pct: Math.round((done / i.subTotal) * 100) };
}

/** `50% · 2/4`, or the not-loaded text; null when there is nothing to show. */
export function progressText(p: SubProgress): string | null {
  if (p.kind === "none") return null;
  return p.kind === "unloaded" ? "— progress not loaded" : `${p.pct}% · ${p.done}/${p.total}`;
}

export const PROGRESS_TOOLTIP = "Counted by GitHub";

/** Sort key: the completed share, null (sorts last) without children or counts. */
export function progressKey(i: SubCounts): number | null {
  const p = subProgress(i);
  return p.kind === "counted" ? p.done / p.total : null;
}
