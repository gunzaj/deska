// Insights (IMPROVEMENTS F4): the numbers behind the page, scoped to the whole
// repo, a dimension value (e.g. one team), a Release or any saved view. Pure, so a scope's counts can be
// tested against the explorer filtered the same way.
import type { Filter, View } from "../views/view";
import { dimKey } from "../sync/field-map";
import { runExplorer } from "./explorer";
import type { ClientIssue, ClientMeta, ClientPr } from "./types";

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
export function scopeFilters(s: Scope, views: Pick<View, "id" | "filters" | "entity">[]): Filter[] | null {
  switch (s.kind) {
    case "all":
      return [];
    case "dim":
      return [{ field: dimKey(s.field), op: "in", values: [s.id] }];
    case "release":
      return [{ field: "release", op: "in", values: [s.id] }];
    case "view": {
      const v = views.find((x) => x.id === s.id && x.entity !== "pr");
      return v ? v.filters : null;
    }
  }
}

export function scopedIssues(issues: ClientIssue[], s: Scope, views: Pick<View, "id" | "filters" | "entity">[], meta: ClientMeta): ClientIssue[] {
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
  const age = (iso: string) => (now - Date.parse(iso)) / DAY;
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

export const WAIT_DAYS = [2, 5, 10] as const;
export const DEFAULT_WAIT_DAYS = 5;

export function parseWaitDays(raw: string | null | undefined): number {
  const n = Number(raw);
  return (WAIT_DAYS as readonly number[]).includes(n) ? n : DEFAULT_WAIT_DAYS;
}

/**
 * When a PR started waiting for review: GitHub gives no request time, so the
 * later of its opening and the latest review on it (a new round starts after
 * a review).
 */
export function waitingSince(p: Pick<ClientPr, "createdAt" | "reviews">): string {
  return p.reviews.reduce((latest, r) => (r.submittedAt && r.submittedAt > latest ? r.submittedAt : latest), p.createdAt);
}

export type ReviewerWait = { key: string; label: string; kind: "user" | "team"; prs: ClientPr[] };

/**
 * Open, ready (not draft) PRs with a pending review request that have waited
 * more than `days`, grouped by who is asked (a person or a team, so a PR asking
 * two reviewers is in both). Longest wait first inside each group.
 */
export function waitingForReview(prs: ClientPr[], days: number, now: number): ReviewerWait[] {
  const groups = new Map<string, ReviewerWait>();
  for (const p of prs) {
    if (p.state !== "open" || p.isDraft || !p.reviewRequests.length) continue;
    if ((now - Date.parse(waitingSince(p))) / DAY <= days) continue;
    for (const r of p.reviewRequests) {
      const key = `${r.kind}:${r.reviewer}`;
      const g = groups.get(key) ?? { key, label: r.kind === "team" ? `team/${r.reviewer}` : r.reviewer, kind: r.kind, prs: [] };
      g.prs.push(p);
      groups.set(key, g);
    }
  }
  const out = [...groups.values()];
  for (const g of out) g.prs.sort((a, b) => waitingSince(a).localeCompare(waitingSince(b)));
  return out.sort((a, b) => b.prs.length - a.prs.length || a.label.localeCompare(b.label));
}

/** PRs that close at least one of these issues: how a scope narrows the PR tile. */
export function prsForIssues(prs: ClientPr[], issues: ClientIssue[]): ClientPr[] {
  const ids = new Set(issues.map((i) => i.nodeId));
  return prs.filter((p) => p.closingIssues.some((n) => ids.has(n)));
}
