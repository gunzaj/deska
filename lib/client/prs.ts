// Pure PR lens logic (SPEC §13.3): filtering, grouping and URL state.
import type { PrFilter, PrFilterField, PrViewState } from "../views/pr-view";
import type { ClientPr } from "./types";

export type PrStateKey = "open" | "draft" | "merged" | "closed";
export type PrCtx = { me: string; myTeams: string[] };

export function prStateKey(p: Pick<ClientPr, "state" | "isDraft">): PrStateKey {
  return p.state === "open" ? (p.isDraft ? "draft" : "open") : p.state;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Asked to review directly, or through a team the viewer is in. */
export function requestedFrom(p: ClientPr, c: PrCtx): boolean {
  return p.reviewRequests.some((r) => (r.kind === "user" ? same(r.reviewer, c.me) : c.myTeams.some((t) => same(t, r.reviewer))));
}

export function checksKey(s: string | null): string {
  if (s === "SUCCESS") return "SUCCESS";
  if (s === "FAILURE" || s === "ERROR") return "FAILURE";
  if (s === "PENDING" || s === "EXPECTED") return "PENDING";
  return "none";
}

export function decisionKey(s: string | null): string {
  return s ?? "none";
}

const me = (v: string, c: PrCtx) => (v === "me" ? c.me : v.toLowerCase());

export function matchPr(p: ClientPr, f: PrFilter, c: PrCtx): boolean {
  switch (f.field) {
    case "state":
      return !f.values.length || f.values.includes(prStateKey(p));
    case "author":
      return !f.values.length || f.values.some((v) => same(me(v, c), p.author));
    case "assignee":
      return !f.values.length || f.values.some((v) => p.assignees.some((a) => same(a, me(v, c))));
    case "requested":
      return (
        !f.values.length ||
        f.values.some((v) =>
          v === "me"
            ? requestedFrom(p, c)
            : v.startsWith("team:")
              ? p.reviewRequests.some((r) => r.kind === "team" && same(r.reviewer, v.slice(5)))
              : p.reviewRequests.some((r) => r.kind === "user" && same(r.reviewer, v)),
        )
      );
    case "reviewedBy":
      return !f.values.length || f.values.some((v) => p.reviews.some((r) => same(r.author, me(v, c))));
    case "decision":
      return !f.values.length || f.values.includes(decisionKey(p.reviewDecision));
    case "checks":
      return !f.values.length || f.values.includes(checksKey(p.checksState));
    case "label":
      return !f.values.length || f.values.some((v) => p.labelIds.includes(v));
    case "milestone":
      return !f.values.length || (p.milestoneId != null && f.values.includes(p.milestoneId));
    case "linked":
      return !f.values.length || f.values.includes(p.closingIssues.length ? "yes" : "no");
    case "text": {
      const q = f.value.trim().toLowerCase().replace(/^#/, "");
      return !q || String(p.number) === q || p.title.toLowerCase().includes(q) || p.headRef.toLowerCase().includes(q);
    }
  }
}

export function runPrs(prs: ClientPr[], s: Pick<PrViewState, "filters" | "sort" | "dir">, c: PrCtx): ClientPr[] {
  const out = prs.filter((p) => s.filters.every((f) => matchPr(p, f, c)));
  const key = (p: ClientPr) => (s.sort === "number" ? p.number : s.sort === "created" ? p.createdAt : p.updatedAt);
  const dir = s.dir === "asc" ? 1 : -1;
  return out.sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : b.number - a.number));
}

export type PrGroupRow = { key: string; label: string; rows: ClientPr[] };

const DECISION_LABEL: Record<string, string> = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REVIEW_REQUIRED: "Review required", none: "No review decision" };
const CHECKS_LABEL: Record<string, string> = { FAILURE: "Checks failing", PENDING: "Checks running", SUCCESS: "Checks passing", none: "No checks" };
const STATE_LABEL: Record<PrStateKey, string> = { open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" };

export function groupPrs(rows: ClientPr[], groupBy: PrViewState["groupBy"], labelName: (id: string) => string): PrGroupRow[] {
  if (!groupBy) return [{ key: "all", label: "", rows }];
  const map = new Map<string, PrGroupRow>();
  const add = (key: string, label: string, p: ClientPr) => {
    const g = map.get(key) ?? { key, label, rows: [] };
    g.rows.push(p);
    map.set(key, g);
  };
  for (const p of rows) {
    if (groupBy === "author") add(p.author.toLowerCase(), p.author, p);
    else if (groupBy === "decision") add(decisionKey(p.reviewDecision), DECISION_LABEL[decisionKey(p.reviewDecision)] ?? p.reviewDecision ?? "", p);
    else if (groupBy === "checks") add(checksKey(p.checksState), CHECKS_LABEL[checksKey(p.checksState)]!, p);
    else if (groupBy === "state") add(prStateKey(p), STATE_LABEL[prStateKey(p)], p);
    else if (groupBy === "label") {
      if (!p.labelIds.length) add("∅", "No labels", p);
      for (const id of p.labelIds) add(id, labelName(id), p);
    }
  }
  const order: Record<string, string[]> = {
    decision: ["CHANGES_REQUESTED", "REVIEW_REQUIRED", "APPROVED", "none"],
    checks: ["FAILURE", "PENDING", "SUCCESS", "none"],
    state: ["open", "draft", "merged", "closed"],
  };
  const o = order[groupBy];
  return [...map.values()].sort((a, b) =>
    o ? o.indexOf(a.key) - o.indexOf(b.key) : a.key === "∅" ? 1 : b.key === "∅" ? -1 : b.rows.length - a.rows.length || a.label.localeCompare(b.label),
  );
}

export const PR_FILTER_FIELDS: { key: PrFilterField; label: string; icon: string }[] = [
  { key: "state", label: "State", icon: "circleDot" },
  { key: "requested", label: "Review requested", icon: "eye" },
  { key: "author", label: "Author", icon: "user" },
  { key: "reviewedBy", label: "Reviewed by", icon: "check" },
  { key: "decision", label: "Review decision", icon: "circleCheck" },
  { key: "checks", label: "Checks", icon: "zap" },
  { key: "assignee", label: "Assignee", icon: "users" },
  { key: "label", label: "Label", icon: "tag" },
  { key: "milestone", label: "Milestone", icon: "milestone" },
  { key: "linked", label: "Linked issue", icon: "link" },
];

export const DEFAULT_PR_STATE: PrViewState = { filters: [{ field: "state", values: ["open", "draft"] }], sort: "updated", dir: "desc", groupBy: "", layout: "list" };

export { CHECKS_LABEL, DECISION_LABEL, STATE_LABEL };
