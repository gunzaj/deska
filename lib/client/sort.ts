import type { View } from "@/lib/views/view";

export type SortKeys = View["sort"];
export const MAX_SORT_KEYS = 4;

/**
 * A click on a column header: one key, flipping its direction. Shift-click adds
 * the column as the next key (up to four), or flips it if it is already there.
 */
export function toggleSortKey(sort: SortKeys, field: string, defaultDir: "asc" | "desc", additive: boolean): SortKeys {
  const at = sort.findIndex((s) => s.field === field);
  const flip = (d: "asc" | "desc") => (d === "asc" ? "desc" : "asc");
  if (additive) {
    if (at >= 0) return sort.map((s, i) => (i === at ? { ...s, dir: flip(s.dir) } : s));
    return [...sort, { field, dir: defaultDir }].slice(0, MAX_SORT_KEYS);
  }
  const cur = sort[0];
  return [{ field, dir: cur?.field === field ? flip(cur.dir) : defaultDir }];
}
