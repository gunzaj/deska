// Pure explorer logic shared by every issue list: field registry, URL state,
// filtering (via the saved-view engine), ordered grouping.
import { dimFieldId, isDimKey, MISSING_FIELD } from "../sync/field-map";
import { runView, type ViewContext } from "../views/engine";
import type { Filter, View } from "../views/view";
import type { ClientDimension, ClientIssue, ClientMeta, DimKey, SingleSelectKey } from "./types";

export type Layout = View["layout"];
export type GroupField = "status" | "priority" | "release" | "type" | "assignee" | "label" | "milestone" | "parent" | DimKey;
export type BoardField = NonNullable<View["boardColumnsField"]>;
export type SortField = "priority" | "status" | "updated" | "created" | "number" | "title" | "release" | "progress" | DimKey;

/** The mapped dimension a `dim:<fieldId>` key names, if it is (still) mapped. */
export function dimensionOf(meta: Pick<ClientMeta, "dimensions">, key: string | undefined | null): ClientDimension | undefined {
  return isDimKey(key) ? meta.dimensions.find((d) => d.id === dimFieldId(key)) : undefined;
}

/** A dimension's label: its field's current name, or "Missing field — remap" once it was deleted (§4.1). */
export function dimensionLabel(meta: Pick<ClientMeta, "dimensions">, key: string): string {
  const d = dimensionOf(meta, key);
  return !d || d.missing ? MISSING_FIELD : d.name;
}

/** Whether sprint features show: a Sprint (iteration) field is mapped and still exists (§4.1). */
export function sprintOn(meta: Pick<ClientMeta, "mapping">): boolean {
  return !!meta.mapping.sprint && !meta.mapping.sprint.missing;
}

/** The first mapped dimension: what triage, planning and the sidebar use as "the" grouping dimension. */
export function primaryDimension(meta: Pick<ClientMeta, "dimensions">): ClientDimension | undefined {
  return meta.dimensions.find((d) => !d.missing);
}

/** Usable dimensions (deleted ones are reported, not offered). */
const liveDims = (meta: Pick<ClientMeta, "dimensions">) => meta.dimensions.filter((d) => !d.missing);
/** Leave the Sprint entries out when no Sprint field is mapped. */
const withSprint = <T extends { key: string }>(meta: Pick<ClientMeta, "mapping">, list: T[]) => (sprintOn(meta) ? list : list.filter((x) => x.key !== "release"));

/** Properties a row/card/table can show: fixed ones, then one per dimension. */
const BASE_PROPS = [
  { key: "id", label: "ID" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "release", label: "Release" },
  { key: "type", label: "Type" },
  { key: "labels", label: "Labels" },
  { key: "parent", label: "Epic" },
  { key: "subissues", label: "Progress" },
  { key: "milestone", label: "Milestone" },
  { key: "assignee", label: "Assignee" },
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
] as const;
export type DisplayProp = (typeof BASE_PROPS)[number]["key"] | DimKey;
export const DEFAULT_PROPS: DisplayProp[] = ["id", "status", "priority", "labels", "parent", "subissues", "release", "assignee", "updated"];

export function displayProps(meta: Pick<ClientMeta, "dimensions" | "mapping">): { key: DisplayProp; label: string }[] {
  const base: { key: DisplayProp; label: string }[] = withSprint(meta, [...BASE_PROPS]);
  const at = base.findIndex((p) => p.key === "priority") + 1;
  return [...base.slice(0, at), ...liveDims(meta).map((d) => ({ key: d.key, label: d.name })), ...base.slice(at)];
}

export function groupOptions(meta: Pick<ClientMeta, "dimensions" | "mapping">): { key: GroupField | ""; label: string }[] {
  return withSprint(meta, [
    { key: "", label: "No grouping" },
    { key: "status", label: "Status" },
    { key: "priority", label: "Priority" },
    ...liveDims(meta).map((d) => ({ key: d.key, label: d.name })),
    { key: "release", label: "Release" },
    { key: "type", label: "Type" },
    { key: "assignee", label: "Assignee" },
    { key: "label", label: "Label" },
    { key: "parent", label: "Epic" },
    { key: "milestone", label: "Milestone" },
  ] as { key: GroupField | ""; label: string }[]);
}

export function boardOptions(meta: Pick<ClientMeta, "dimensions" | "mapping">): { key: BoardField; label: string }[] {
  return withSprint(meta, [
    { key: "status", label: "Status" },
    { key: "priority", label: "Priority" },
    ...liveDims(meta).map((d) => ({ key: d.key, label: d.name })),
    { key: "release", label: "Release" },
    { key: "assignee", label: "Assignee" },
    { key: "type", label: "Type" },
  ] as { key: BoardField; label: string }[]);
}

export function sortOptions(meta: Pick<ClientMeta, "dimensions" | "mapping">): { key: SortField; label: string; defaultDir: "asc" | "desc" }[] {
  return withSprint(meta, [
    { key: "priority", label: "Priority", defaultDir: "desc" },
    { key: "updated", label: "Last updated", defaultDir: "desc" },
    { key: "created", label: "Created", defaultDir: "desc" },
    { key: "status", label: "Status", defaultDir: "asc" },
    { key: "release", label: "Release", defaultDir: "asc" },
    ...liveDims(meta).map((d) => ({ key: d.key, label: d.name, defaultDir: "asc" as const })),
    { key: "progress", label: "Progress", defaultDir: "desc" },
    { key: "number", label: "Issue number", defaultDir: "desc" },
    { key: "title", label: "Title", defaultDir: "asc" },
  ] as { key: SortField; label: string; defaultDir: "asc" | "desc" }[]);
}

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

export type FilterFieldKey = "status" | "priority" | "release" | "type" | "assignee" | "label" | "milestone" | "state" | "parent" | DimKey;

export type FilterValue = { id: string; label: string; color?: string | null; kind?: "relative" | "me" | "special" };

const FIXED_FILTERS: { key: FilterFieldKey; label: string; icon: string }[] = [
  { key: "status", label: "Status", icon: "circleDot" },
  { key: "priority", label: "Priority", icon: "flag" },
  { key: "assignee", label: "Assignee", icon: "user" },
  { key: "release", label: "Release", icon: "calendar" },
  { key: "type", label: "Type", icon: "box" },
  { key: "label", label: "Label", icon: "tag" },
  { key: "parent", label: "Epic", icon: "epic" },
  { key: "milestone", label: "Milestone", icon: "milestone" },
  { key: "state", label: "State", icon: "circleCheck" },
];

/** The fields a list can filter by: the fixed ones and every mapped dimension (`dim:<fieldId>`). */
export function filterFields(meta: Pick<ClientMeta, "dimensions" | "mapping">): { key: FilterFieldKey; label: string; icon: string }[] {
  const fixed = withSprint(meta, FIXED_FILTERS);
  const at = fixed.findIndex((f) => f.key === "assignee") + 1;
  return [...fixed.slice(0, at), ...liveDims(meta).map((d) => ({ key: d.key, label: d.name, icon: "users" })), ...fixed.slice(at)];
}

export function filterValues(field: FilterFieldKey, meta: ClientMeta, issues: ClientIssue[]): FilterValue[] {
  if (isDimKey(field)) return (dimensionOf(meta, field)?.options ?? []).map((o) => ({ id: o.id, label: o.name, color: o.color }));
  switch (field) {
    case "status":
      return meta.fields.status.map((o) => ({ id: o.id, label: o.name, color: o.color }));
    case "priority":
      // Highest first reads best; `meta.fields.priority` is lowest to highest.
      return meta.fields.priority.map((o) => ({ id: o.id, label: o.name, color: o.color })).reverse();
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
  return [];
}

/** A filter field's label; a dimension's is its field's name (or "Missing field — remap"). */
export function fieldLabel(key: string, meta?: Pick<ClientMeta, "dimensions">): string {
  if (isDimKey(key)) return meta ? dimensionLabel(meta, key) : MISSING_FIELD;
  return FIXED_FILTERS.find((f) => f.key === key)?.label ?? key;
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
  if (isDimKey(field)) {
    const v = i.dims[dimFieldId(field)];
    return v ? [v.id] : [];
  }
  switch (field) {
    case "status":
      return i.statusId ? [i.statusId] : [];
    case "priority":
      return i.priorityId ? [i.priorityId] : [];
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
  return [];
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
  const view: View = { id: "", name: "", layout: "list", filters, sort };
  return runView(view, viewContext(meta), issues) as ClientIssue[];
}

export type Group = { key: string; label: string; color?: string | null; field: string; rows: ClientIssue[] };

/** Label for a value whose option was deleted in GitHub (SPEC §4). */
const MISSING = "Missing option";
/** Deleted options sort after the known ones, just before "No value". */
const UNKNOWN = 1e9 - 1;
const known = (index: number) => (index < 0 ? UNKNOWN : index);

/** The options of a single-select field or dimension key. */
function optionsOf(meta: ClientMeta, field: string) {
  if (isDimKey(field)) return dimensionOf(meta, field)?.options ?? [];
  return field === "status" || field === "priority" ? meta.fields[field as SingleSelectKey] : [];
}

const isSingleSelect = (field: string) => field === "status" || field === "priority" || isDimKey(field);

/** Single-select order: the project's option order (priority highest first), deleted options, then "No value". */
function optionRank(meta: ClientMeta, field: string, key: string): number {
  if (key === "∅") return 1e9;
  const list = optionsOf(meta, field);
  const at = list.findIndex((o) => o.id === key);
  if (at < 0) return UNKNOWN;
  // `meta.fields.priority` is lowest to highest; groups read highest first.
  return field === "priority" ? list.length - at : at;
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
  const optColor = (field: string, id: string) => optionsOf(meta, field).find((o) => o.id === id)?.color ?? null;
  const dimLabel = isDimKey(groupBy) ? dimensionLabel(meta, groupBy) : "";
  for (const r of rows) {
    if (isDimKey(groupBy)) {
      const v = r.dims[dimFieldId(groupBy)];
      add(v?.id ?? "∅", v ? (v.name ?? MISSING) : `No ${dimLabel}`, v ? optColor(groupBy, v.id) : null, r);
      continue;
    }
    switch (groupBy) {
      case "status":
      case "priority": {
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
    if (isSingleSelect(groupBy)) return optionRank(meta, groupBy, g.key);
    switch (groupBy) {
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
  if (isSingleSelect(field)) {
    const have = new Set(groups.map((g) => g.key));
    const empties: Group[] = optionsOf(meta, field)
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
