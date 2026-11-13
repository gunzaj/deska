// Insights (IMPROVEMENTS F4): the numbers behind the page, scoped to the whole
// repo, a dimension value (e.g. one team), a Release or any saved view. Pure, so a scope's counts can be
// tested against the explorer filtered the same way.
import type { Filter, View } from "../views/view";
import { dimKey } from "../sync/field-map";
import { runExplorer } from "./explorer";
import type { ClientIssue, ClientMeta } from "./types";

const DAY = 86_400_000;

export type Scope = { kind: "all" } | { kind: "release" | "view"; id: string } | { kind: "dim"; field: string; id: string };
export const ALL_SCOPE: Scope = { kind: "all" };

/** `dim:<field id>:<option id>`, `release:<iteration id>`, `view:<view id>`; anything else is the whole repo. */
export function parseScope(raw: string | null | undefined): Scope {
  const d = /^dim:([^:]+):(.+)$/.exec(raw ?? "");
  if (d) return { kind: "dim", field: d[1]!, id: d[2]! };
  const m = /^(release|view):(.+)$/.exec(raw ?? "");
  return m ? { kind: m[1] as "release" | "view", id: m[2]! } : ALL_SCOPE;
}

export function scopeParam(s: Scope): string | null {
  if (s.kind === "all") return null;
  return s.kind === "dim" ? `dim:${s.field}:${s.id}` : `${s.kind}:${s.id}`;
}

/** The filters a scope means. A saved view runs its filters and ignores its layout and sort. Null: a view that doesn't exist (any more). */
export function scopeFilters(s: Scope, views: Pick<View, "id" | "filters">[]): Filter[] | null {
  switch (s.kind) {
    case "all":
      return [];
    case "dim":
      return [{ field: dimKey(s.field), op: "in", values: [s.id] }];
    case "release":
      return [{ field: "release", op: "in", values: [s.id] }];
    case "view": {
      const v = views.find((x) => x.id === s.id);
      return v ? v.filters : null;
    }
  }
}

export function scopedIssues(issues: ClientIssue[], s: Scope, views: Pick<View, "id" | "filters">[], meta: ClientMeta): ClientIssue[] {
  const filters = scopeFilters(s, views);
  // A view scope that no longer exists matches nothing, not the whole repo.
  if (!filters) return [];
  return filters.length ? runExplorer(issues, filters, [], meta) : issues;
}

export const AGE_BUCKETS = [
  { key: "7", label: "Under a week", lo: 0, hi: 7 },
  { key: "30", label: "1–4 weeks", lo: 7, hi: 30 },
  { key: "90", label: "1–3 months", lo: 30, hi: 90 },
  { key: "180", label: "3–6 months", lo: 90, hi: 180 },
  { key: "365", label: "6–12 months", lo: 180, hi: 365 },
  { key: "old", label: "Over a year", lo: 365, hi: Infinity },
];

export function insightStats(issues: ClientIssue[], meta: ClientMeta, triageBase: Filter[]) {
  const open = issues.filter((i) => i.state === "open");
  const now = Date.parse(`${meta.today}T23:59:59Z`);
  // Never negative: `now` is the end of the viewer's date read as UTC, so west of
  // UTC in the evening an issue made in the last hours is "after" it, and a
  // negative age fell out of every bucket.
  const age = (iso: string) => Math.max(0, (now - Date.parse(iso)) / DAY);
  const count = <K extends string>(rows: ClientIssue[], key: (i: ClientIssue) => K[]) => {
    const m = new Map<K, number>();
    for (const r of rows) for (const k of key(r)) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  return {
    open,
    triage: runExplorer(issues, triageBase, [], meta).length,
    noRelease: open.filter((i) => !i.releaseId).length,
    stale: open.filter((i) => age(i.updatedAt) > 90).length,
    created30: issues.filter((i) => age(i.createdAt) <= 30).length,
    closed30: issues.filter((i) => i.closedAt && age(i.closedAt) <= 30).length,
    /** Open issues per value, for each mapped dimension (by field ID). */
    byDim: new Map(meta.dimensions.map((d) => [d.id, count(open, (i) => [i.dims[d.id]?.id ?? "∅"])])),
    byPriority: count(open, (i) => [i.priorityId ?? "∅"]),
    byType: count(open, (i) => [i.typeId ?? "∅"]),
    byAssignee: count(open, (i) => (i.assignees.length ? i.assignees : ["∅"])),
    byLabel: count(open, (i) => i.labelIds),
    ages: AGE_BUCKETS.map((b) => ({ ...b, n: open.filter((i) => age(i.createdAt) >= b.lo && age(i.createdAt) < b.hi).length })),
  };
}
