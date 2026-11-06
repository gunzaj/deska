// Pure explorer logic shared by every issue list: field registry, URL state,
// filtering (via the saved-view engine), ordered grouping.
import { runView, type ViewContext } from "../views/engine";
import type { Filter, View } from "../views/view";
import type { ClientIssue, ClientMeta, SingleSelectKey } from "./types";

export type Layout = View["layout"];
export type GroupField = "status" | "priority" | "team" | "platform" | "release" | "type" | "assignee" | "label" | "milestone" | "parent";
export type BoardField = NonNullable<View["boardColumnsField"]>;
export type SortField = "priority" | "status" | "updated" | "created" | "number" | "title" | "release" | "team";

/** Properties a row/card/table can show. */
export const DISPLAY_PROPS = [
  { key: "id", label: "ID" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "team", label: "Team" },
  { key: "platform", label: "Platform" },
  { key: "release", label: "Release" },
  { key: "type", label: "Type" },
  { key: "labels", label: "Labels" },
  { key: "parent", label: "Epic" },
  { key: "subissues", label: "Sub-issues" },
  { key: "milestone", label: "Milestone" },
  { key: "assignee", label: "Assignee" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
] as const;
export type DisplayProp = (typeof DISPLAY_PROPS)[number]["key"];
export const DEFAULT_PROPS: DisplayProp[] = ["id", "status", "priority", "labels", "parent", "subissues", "release", "assignee", "updated"];

export const GROUP_OPTIONS: { key: GroupField | ""; label: string }[] = [
  { key: "", label: "No grouping" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "team", label: "Team" },
  { key: "platform", label: "Platform" },
  { key: "release", label: "Release" },
  { key: "type", label: "Type" },
  { key: "assignee", label: "Assignee" },
  { key: "label", label: "Label" },
  { key: "parent", label: "Epic" },
  { key: "milestone", label: "Milestone" },
];

export const BOARD_OPTIONS: { key: BoardField; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "team", label: "Team" },
  { key: "platform", label: "Platform" },
  { key: "release", label: "Release" },
  { key: "assignee", label: "Assignee" },
  { key: "type", label: "Type" },
];

export const SORT_OPTIONS: { key: SortField; label: string; defaultDir: "asc" | "desc" }[] = [
  { key: "priority", label: "Priority", defaultDir: "desc" },
  { key: "updated", label: "Last updated", defaultDir: "desc" },
  { key: "created", label: "Created", defaultDir: "desc" },
  { key: "status", label: "Status", defaultDir: "asc" },
  { key: "release", label: "Release", defaultDir: "asc" },
  { key: "team", label: "Team", defaultDir: "asc" },
  { key: "number", label: "Issue number", defaultDir: "desc" },
  { key: "title", label: "Title", defaultDir: "asc" },
];

/** Everything about a list except its identity — what the URL carries. */
export type ExplorerState = {
  filters: Filter[];
  sort: View["sort"];
  groupBy?: string;
  layout: Layout;
  boardColumnsField?: BoardField;
  columns?: string[];
};

export function stateOf(v: Pick<View, "filters" | "sort" | "groupBy" | "layout" | "boardColumnsField" | "columns">): ExplorerState {
  return {
    filters: v.filters,
    sort: v.sort,
    ...(v.groupBy ? { groupBy: v.groupBy } : {}),
    layout: v.layout,
    ...(v.boardColumnsField ? { boardColumnsField: v.boardColumnsField } : {}),
    ...(v.columns ? { columns: v.columns } : {}),
  };
}

/**
 * The view with this state saved into it. Optional keys the state lacks (e.g.
 * grouping switched off) are cleared rather than kept from the old view.
 */
export function applyState(view: View, s: ExplorerState): View {
  return { ...view, ...s, groupBy: s.groupBy, boardColumnsField: s.boardColumnsField, columns: s.columns };
}

/** Stable comparison that ignores key order and absent-vs-undefined. */
export function sameState(a: ExplorerState, b: ExplorerState): boolean {
  const norm = (s: ExplorerState) =>
    JSON.stringify({
      f: s.filters,
      s: s.sort,
      g: s.groupBy ?? null,
      l: s.layout,
      b: s.boardColumnsField ?? null,
      c: s.columns ?? null,
    });
  return norm(a) === norm(b);
}

// ---------- Filter fields ----------------------------------------------------

export type FilterFieldKey = "status" | "priority" | "team" | "platform" | "release" | "type" | "assignee" | "label" | "milestone" | "state" | "parent";

export type FilterValue = { id: string; label: string; color?: string | null; kind?: "relative" | "me" | "special" };

export const FILTER_FIELDS: { key: FilterFieldKey; label: string; icon: string }[] = [
  { key: "status", label: "Status", icon: "circleDot" },
  { key: "priority", label: "Priority", icon: "flag" },
  { key: "assignee", label: "Assignee", icon: "user" },
  { key: "team", label: "Team", icon: "users" },
  { key: "release", label: "Release", icon: "calendar" },
  { key: "platform", label: "Platform", icon: "monitorSmartphone" },
  { key: "type", label: "Type", icon: "box" },
  { key: "label", label: "Label", icon: "tag" },
  { key: "parent", label: "Epic", icon: "epic" },
  { key: "milestone", label: "Milestone", icon: "milestone" },
  { key: "state", label: "State", icon: "circleCheck" },
];

export function filterValues(field: FilterFieldKey, meta: ClientMeta, issues: ClientIssue[]): FilterValue[] {
  switch (field) {
    case "status":
    case "priority":
    case "team":
    case "platform": {
      const list = meta.fields[field as SingleSelectKey].map((o) => ({ id: o.id, label: o.name, color: o.color }));
      // Priority reads best highest-first; GitHub stores it lowest-first.
      return field === "priority" ? list.reverse() : list;
    }
    case "release": {
      const rel = [...meta.releases].reverse().map((r) => ({
        id: r.id,
        label: r.id === meta.currentReleaseId ? `${r.title} (current)` : r.title,
      }));
      return [
        { id: "current", label: "Current release", kind: "relative" as const },
        { id: "next", label: "Next release", kind: "relative" as const },
        { id: "previous", label: "Previous release", kind: "relative" as const },
        ...rel,
      ];
    }
    case "type":
      return meta.issueTypes.map((t) => ({ id: t.id, label: t.name, color: t.color }));
    case "label":
      return meta.labels.map((l) => ({ id: l.id, label: l.name, color: l.color }));
    case "milestone":
      return meta.milestones.map((m) => ({ id: m.id, label: m.title }));
    case "assignee":
      return [{ id: "me", label: "Me", kind: "me" as const }, ...meta.users.map((u) => ({ id: u.login, label: u.login }))];
    case "state":
      return [
        { id: "open", label: "Open" },
        { id: "closed", label: "Closed" },
      ];
    case "parent":
      return issues
        .filter((i) => i.hasSubIssues)
        .sort((a, b) => (a.state === b.state ? b.updatedAt.localeCompare(a.updatedAt) : a.state === "open" ? -1 : 1))
        .map((i) => ({ id: i.nodeId, label: `#${i.number} ${i.title}` }));
  }
}

export function fieldLabel(key: string): string {
  return FILTER_FIELDS.find((f) => f.key === key)?.label ?? key;
}

/** Value label for chips; falls back to "missing option" for deleted IDs (SPEC §4). */
export function valueLabel(field: FilterFieldKey, id: string, meta: ClientMeta, issues: ClientIssue[]): string {
  if (field === "parent") {
    const i = issues.find((x) => x.nodeId === id);
    return i ? `#${i.number}` : "missing issue";
  }
  const v = filterValues(field, meta, []).find((x) => x.id === id);
  if (v) return field === "release" ? v.label.replace(" (current)", "") : v.label;
  return field === "assignee" ? id : "missing option";
}

/** Issue's value IDs for a filter field (used for counts in pickers). */
export function issueValueIds(i: ClientIssue, field: FilterFieldKey): string[] {
  switch (field) {
    case "status":
      return i.statusId ? [i.statusId] : [];
    case "priority":
      return i.priorityId ? [i.priorityId] : [];
    case "team":
      return i.teamId ? [i.teamId] : [];
    case "platform":
      return i.platformId ? [i.platformId] : [];
    case "release":
      return i.releaseId ? [i.releaseId] : [];
    case "type":
      return i.typeId ? [i.typeId] : [];
    case "label":
      return i.labelIds;
    case "milestone":
      return i.milestoneId ? [i.milestoneId] : [];
    case "assignee":
      return i.assignees;
    case "state":
      return [i.state];
    case "parent":
      return i.parentNodeId ? [i.parentNodeId] : [];
  }
}

// ---------- Running --------------------------------------------------------------

function viewContext(meta: ClientMeta): ViewContext {
  return {
    viewerLogin: meta.viewer,
    todayIso: meta.today,
    resolveRelease: (w) => (w === "current" ? meta.currentReleaseId : w === "next" ? meta.nextReleaseId : meta.previousReleaseId),
  };
}

export function runExplorer(issues: ClientIssue[], filters: Filter[], sort: View["sort"], meta: ClientMeta): ClientIssue[] {
  const view: View = { id: "", name: "", ownerId: "", visibility: "personal", layout: "list", filters, sort };
  return runView(view, viewContext(meta), issues) as ClientIssue[];
}

export type Group = { key: string; label: string; color?: string | null; field: string; rows: ClientIssue[] };

/** Label for a value whose option was deleted in GitHub (SPEC §4). */
const MISSING = "Missing option";
/** Deleted options sort after the known ones, just before "No value". */
const UNKNOWN = 1e9 - 1;
const known = (index: number) => (index < 0 ? UNKNOWN : index);

/** Single-select order: GitHub's option order (priority highest first), deleted options, then "No value". */
function optionRank(meta: ClientMeta, field: SingleSelectKey, key: string): number {
  if (key === "∅") return 1e9;
  const at = meta.fields[field].findIndex((o) => o.id === key);
  if (at < 0) return UNKNOWN;
  // GitHub stores priority lowest first.
  return field === "priority" ? meta.fields.priority.length - at : at;
}

/**
 * Groups in a meaningful order: single-selects by GitHub option order
 * (priority highest first), releases by date, "no value" last. Rows keep the
 * sort order they arrive in.
 */
export function groupIssues(rows: ClientIssue[], groupBy: string | undefined, meta: ClientMeta): Group[] {
  if (!groupBy) return [{ key: "all", label: "", field: "", rows }];
  const map = new Map<string, Group>();
  const add = (key: string, label: string, color: string | null | undefined, r: ClientIssue) => {
    let g = map.get(key);
    if (!g) {
      g = { key, label, color, field: groupBy, rows: [] };
      map.set(key, g);
    }
    g.rows.push(r);
  };
  const optColor = (field: SingleSelectKey, id: string) => meta.fields[field].find((o) => o.id === id)?.color ?? null;
  for (const r of rows) {
    switch (groupBy) {
      case "status":
      case "priority":
      case "team":
      case "platform": {
        const id = r[`${groupBy}Id` as const];
        const name = r[`${groupBy}Name` as const];
        add(id ?? "∅", name ?? (id ? MISSING : `No ${groupBy}`), id ? optColor(groupBy, id) : null, r);
        break;
      }
      case "release":
        add(r.releaseId ?? "∅", r.releaseName ?? (r.releaseId ? MISSING : "No release"), null, r);
        break;
      case "type":
        add(r.typeId ?? "∅", r.typeName ?? (r.typeId ? MISSING : "No type"), meta.issueTypes.find((t) => t.id === r.typeId)?.color ?? null, r);
        break;
      case "milestone":
        add(r.milestoneId ?? "∅", r.milestoneName ?? (r.milestoneId ? MISSING : "No milestone"), null, r);
        break;
      case "parent":
        add(r.parentNodeId ?? "∅", r.parentNodeId ? `#${r.parentNumber ?? "?"} ${r.parentTitle ?? ""}`.trim() : "No epic", null, r);
        break;
      case "assignee":
        if (!r.assignees.length) add("∅", "Unassigned", null, r);
        for (const a of r.assignees) add(a.toLowerCase(), a, null, r);
        break;
      case "label":
        if (!r.labelIds.length) add("∅", "No labels", null, r);
        r.labelIds.forEach((id, i) => add(id, r.labelNames[i] ?? id, meta.labels.find((l) => l.id === id)?.color ?? null, r));
        break;
      default:
        add("all", "", null, r);
    }
  }
  const groups = [...map.values()];
  const order = (g: Group): number => {
    if (g.key === "∅") return 1e9;
    switch (groupBy) {
      case "status":
      case "priority":
      case "team":
      case "platform":
        return optionRank(meta, groupBy, g.key);
      case "release": {
        const at = meta.releases.findIndex((r) => r.id === g.key);
        return at < 0 ? UNKNOWN : -at;
      }
      case "type":
        return known(meta.issueTypes.findIndex((t) => t.id === g.key));
      case "assignee":
        return g.key === meta.viewer.toLowerCase() ? -1 : 0;
      default:
        return 0;
    }
  };
  return groups.sort((a, b) => order(a) - order(b) || (groupBy === "assignee" || groupBy === "label" || groupBy === "milestone" || groupBy === "parent" ? b.rows.length - a.rows.length || a.label.localeCompare(b.label) : 0));
}

// ---------- Board columns ------------------------------------------------------------

/** Board columns: every option of the field (even empty ones) in GitHub order, then "No value". */
export function boardColumns(rows: ClientIssue[], field: BoardField, meta: ClientMeta): Group[] {
  const groups = groupIssues(rows, field, meta);
  if (field === "status" || field === "priority" || field === "team" || field === "platform") {
    const have = new Set(groups.map((g) => g.key));
    const empties: Group[] = meta.fields[field]
      .filter((o) => !have.has(o.id))
      .map((o) => ({ key: o.id, label: o.name, color: o.color, field, rows: [] }));
    const all = [...groups, ...empties];
    return all.sort((a, b) => optionRank(meta, field, a.key) - optionRank(meta, field, b.key));
  }
  return groups;
}

// ---------- URL state ------------------------------------------------------------------

/** Compact, URL-safe encoding of explorer state (base64url JSON). */
export function encodeState(s: ExplorerState): string {
  const json = JSON.stringify(s);
  const b64 = typeof btoa === "function" ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeState(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ---------- Filter editing helpers -------------------------------------------------

type ValuesFilter = Extract<Filter, { values?: string[] }>;

export function isValuesFilter(f: Filter): f is ValuesFilter {
  return f.field !== "text" && f.field !== "any" && !isDateFilter(f);
}

export type DateFilter = Extract<Filter, { days: number }>;
export function isDateFilter(f: Filter): f is DateFilter {
  return "days" in f;
}

export function dateFilterLabel(f: DateFilter): string {
  const what = f.field === "created" ? "Created" : f.field === "updated" ? "Updated" : "Closed";
  return f.op === "within_days" ? `${what} in the last ${f.days} days` : `${what} more than ${f.days} days ago`;
}

export function setFilterValues(filters: Filter[], index: number, values: string[]): Filter[] {
  const next = [...filters];
  const f = next[index];
  if (!f || !isValuesFilter(f)) return filters;
  if (f.field === "state") {
    next[index] = { field: "state", op: "in", values: values.filter((v): v is "open" | "closed" => v === "open" || v === "closed") };
  } else {
    next[index] = { ...f, values } as Filter;
  }
  return next;
}

export function newFilter(field: FilterFieldKey, value?: string): Filter {
  if (field === "state") return { field: "state", op: "in", values: value === "closed" ? ["closed"] : ["open"] };
  if (field === "parent") return { field: "parent", op: "in", values: value ? [value] : [] };
  return { field, op: "in", values: value ? [value] : [] } as Filter;
}

/** Ops offered per field, with Linear-ish wording. */
export function opsFor(field: string): { op: string; label: string }[] {
  if (field === "state") return [{ op: "in", label: "is" }];
  if (field === "parent")
    return [
      { op: "in", label: "is" },
      { op: "empty", label: "has no epic" },
      { op: "has_sub_issues", label: "has sub-issues" },
    ];
  const multi = field === "label" || field === "assignee";
  return [
    { op: "in", label: multi ? "includes any of" : "is" },
    { op: "not_in", label: multi ? "excludes" : "is not" },
    { op: "empty", label: field === "assignee" ? "is unassigned" : "is empty" },
  ];
}

export function stateFilterValue(filters: Filter[]): "open" | "closed" | "all" {
  const f = filters.find((x) => x.field === "state");
  if (!f || f.field !== "state") return "all";
  const v = f.values;
  if (v.length === 1) return v[0]!;
  return "all";
}

export function withStateFilter(filters: Filter[], v: "open" | "closed" | "all"): Filter[] {
  const rest = filters.filter((x) => x.field !== "state");
  return v === "all" ? rest : [{ field: "state", op: "in", values: [v] }, ...rest];
}

/** Cards a board column shows before "Show more". The explorer's j/k stops at the same limit. */
export const CARD_PAGE = 50;
