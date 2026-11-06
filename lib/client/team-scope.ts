// "My default" dimension value (§4.1, §4.2): every list and Insights start
// filtered to the viewer's chosen value of one mapped dimension (e.g. their
// team), so what they see is what concerns them. Pure rules here.
import { dimKey } from "../sync/field-map";
import type { Filter } from "../views/view";
import type { ClientDimension, ClientMeta } from "./types";

/** The default: an option of a mapped dimension, with the dimension it belongs to. */
export type DefaultScope = { dimension: ClientDimension; optionId: string; name: string };

/** The default option, if it still exists in a mapped dimension (an option or field can be deleted on GitHub). */
export function validDefault(optionId: string | null | undefined, meta: Pick<ClientMeta, "dimensions">): DefaultScope | null {
  if (!optionId) return null;
  for (const d of meta.dimensions) {
    if (d.missing) continue;
    const o = d.options.find((x) => x.id === optionId);
    if (o) return { dimension: d, optionId, name: o.name };
  }
  return null;
}

export const scopeFilter = (s: Pick<DefaultScope, "dimension" | "optionId">): Filter => ({ field: dimKey(s.dimension.id), op: "in", values: [s.optionId] });

const mentions = (filters: Filter[], key: string) => filters.some((f) => f.field === key || (f.field === "any" && f.filters.some((g) => g.field === key)));

/**
 * The filters to run: the page's own, plus the default unless the page already
 * says something about that dimension (a saved view for another team stays that team's).
 */
export function withDefaultScope(filters: Filter[], base: Filter[], scope: Pick<DefaultScope, "dimension" | "optionId"> | null): Filter[] {
  if (!scope) return filters;
  const key = dimKey(scope.dimension.id);
  if (mentions(filters, key) || mentions(base, key)) return filters;
  return [...filters, scopeFilter(scope)];
}
