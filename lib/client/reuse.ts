import type { WireData, WireIssue } from "./types";

function sameList(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

/** Whether two wire rows hold the same values (arrays by content). */
export function sameRow(a: WireIssue, b: WireIssue): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof WireIssue>;
  for (const k of keys) {
    const x = a[k];
    const y = b[k];
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!sameList(x as string[] | undefined, y as string[] | undefined)) return false;
    } else if (x !== y) return false;
  }
  return true;
}

/**
 * A freshly parsed payload carries a new object for every row, changed or not.
 * Keep the previous object for each row that did not change, so what is keyed
 * on row identity (the hydration cache, memoized rows) is reused instead of
 * rebuilt for ~3k issues on every refresh (v5 3.3).
 */
export function reuseRows(prev: WireData | null | undefined, next: WireData): WireData {
  if (!prev) return next;
  const before = new Map(prev.issues.map((w) => [w.id, w]));
  let changed = prev.issues.length !== next.issues.length;
  const issues = next.issues.map((w, i) => {
    const old = before.get(w.id);
    if (old && sameRow(old, w)) {
      if (prev.issues[i] !== old) changed = true; // same rows, different order
      return old;
    }
    changed = true;
    return w;
  });
  // Nothing moved: hand back the same array, so it is the same data.
  return { meta: next.meta, issues: changed ? issues : prev.issues };
}
