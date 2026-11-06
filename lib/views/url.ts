import type { View } from "./view";
import { viewSchema } from "./view";

/** URL state: the current filters/sort/grouping live in the query string. */
export function encodeViewState(view: Pick<View, "filters" | "sort" | "groupBy">): string {
  const params = new URLSearchParams();
  params.set("filters", JSON.stringify(view.filters));
  params.set("sort", JSON.stringify(view.sort));
  // Always written (empty = ungrouped): when it was omitted, decoding fell back
  // to the saved view's grouping, so removing the grouping could not round-trip.
  params.set("groupBy", view.groupBy ?? "");
  return params.toString();
}

/**
 * Parse a `filters`/`sort` param, returning the fallback if it is absent or not
 * valid JSON. `JSON.parse` throws on a hand-edited or truncated URL, which
 * used to surface as a 500 instead of falling back to the saved view.
 */
function parseParam(raw: string | null, fallback: unknown): unknown {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const stateSchema = viewSchema.pick({ filters: true, sort: true, groupBy: true });

export function decodeViewState(
  query: string,
  fallback: Pick<View, "filters" | "sort" | "groupBy"> = { filters: [], sort: [] },
): Pick<View, "filters" | "sort" | "groupBy"> {
  const params = new URLSearchParams(query);
  const groupBy = params.get("groupBy");
  const parsed = stateSchema.safeParse({
    filters: parseParam(params.get("filters"), fallback.filters),
    sort: parseParam(params.get("sort"), fallback.sort),
    groupBy: groupBy == null ? fallback.groupBy : groupBy || undefined,
  });
  // A structurally invalid view (unknown field/op) is ignored in favour of the
  // saved state rather than throwing.
  return parsed.success ? parsed.data : fallback;
}
