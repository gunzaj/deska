import { dimFieldId, isDimKey } from "../sync/field-map";
import type { ReadModel } from "../sync/read-model";
import { progressKey } from "../client/progress";
import { resolveRelease, type ViewRow } from "./rows";
import type { Filter, View } from "./view";

export type RelativeRelease = "current" | "next" | "previous";

/**
 * Either a store (server) or a precomputed resolver (browser, which has no
 * ReadModel) answers "which iteration is current/next/previous".
 */
export type ViewContext = {
  viewerLogin: string;
  todayIso: string;
} & (
  | { store: ReadModel; resolveRelease?: undefined }
  | { store?: undefined; resolveRelease: (which: RelativeRelease) => string | null }
);

function releaseValues(values: string[] | undefined, ctx: ViewContext): (string | null)[] {
  return (values ?? []).map((v) =>
    v === "current" || v === "next" || v === "previous"
      ? ctx.resolveRelease
        ? ctx.resolveRelease(v)
        : resolveRelease(ctx.store!, v, ctx.todayIso)
      : v,
  );
}

function fieldValues(row: ViewRow, field: string): (string | null)[] {
  if (isDimKey(field)) return [row.dims[dimFieldId(field)]?.id ?? null];
  switch (field) {
    case "assignee":
      return row.assignees;
    case "status":
      return [row.statusId];
    case "priority":
      return [row.priorityId];
    case "release":
      return [row.releaseId];
    case "type":
      return [row.typeId];
    case "label":
      return row.labelIds;
    case "milestone":
      return [row.milestoneId];
    case "state":
      return [row.state];
    case "parent":
      return [row.parentNodeId];
    default:
      return [];
  }
}

/**
 * A filter turned into a function of a row. Everything that does not depend on
 * the row (the value set, resolved releases, "me", the clock) is worked out
 * once here, not once per row: a run over ~3k issues used to allocate a `Set`
 * and parse the date for every row and filter (v5 3.5).
 */
export type RowTest = (row: ViewRow) => boolean;

export function compileFilter(f: Filter, ctx: ViewContext): RowTest {
  if (f.field === "any") {
    const tests = f.filters.map((x) => compileFilter(x, ctx));
    return (row) => tests.some((t) => t(row));
  }
  if (f.field === "text" && f.op === "contains") return compileText(f.value);
  if (f.field === "created" || f.field === "updated" || f.field === "closed") {
    const now = Date.parse(ctx.todayIso.length === 10 ? `${ctx.todayIso}T23:59:59Z` : ctx.todayIso);
    const pick = (r: ViewRow) => (f.field === "created" ? r.createdAt : f.field === "updated" ? r.updatedAt : r.closedAt);
    return (row) => {
      const iso = pick(row);
      if (!iso) return false;
      const age = (now - Date.parse(iso)) / 86_400_000;
      return f.op === "within_days" ? age <= f.days : age > f.days;
    };
  }
  if (f.field === "parent" && f.op === "has_sub_issues") return (row) => row.hasSubIssues;
  if (f.field === "parent" && f.op === "empty") return (row) => row.parentNodeId == null;
  if (f.field === "parent" && f.op === "in") {
    const set = new Set(f.values ?? []);
    return (row) => set.has(row.parentNodeId ?? "");
  }
  const op = (f as { op: string }).op;
  const field = f.field;
  let values: (string | null | undefined)[] | undefined;
  if (field === "release") {
    values = releaseValues((f as { values?: string[] }).values, ctx);
  } else if (field === "assignee") {
    values = ((f as { values?: string[] }).values ?? []).map((v) => (v === "me" ? ctx.viewerLogin : v));
  } else {
    values = (f as { values?: string[] }).values;
  }
  // Logins are case-insensitive on GitHub; "me" comes from the session.
  const lower = field === "assignee";
  const set = new Set((lower ? values?.map((v) => v?.toLowerCase()) : values) ?? []);
  if (op === "empty") return (row) => fieldValues(row, field).every((a) => a == null);
  const hits = (row: ViewRow) => {
    for (const a of fieldValues(row, field)) {
      const v = lower ? a?.toLowerCase() : a;
      if (v != null && set.has(v)) return true;
    }
    return false;
  };
  if (op === "in") return hits;
  // not_in: rows with no value count as not-in (they don't hold a blocked value)
  return (row) => !hits(row);
}

export function matchesFilter(row: ViewRow, f: Filter, ctx: ViewContext): boolean {
  return compileFilter(f, ctx)(row);
}

/**
 * `#123` (or a bare number) matches that issue exactly — substring matching made
 * "#12" also hit #120–#129. Anything else is a case-insensitive match on the
 * title, where every word must appear. Bodies are not searched: they are not
 * in the client payload (IMPROVEMENTS S5, Q2).
 */
export function compileText(raw: string): RowTest {
  const q = raw.trim().toLowerCase();
  if (!q) return () => true;
  const num = /^#?(\d+)$/.exec(q);
  if (num) {
    const n = Number(num[1]);
    const bare = !q.startsWith("#");
    return (row) => row.number === n || (bare && row.title.toLowerCase().includes(q));
  }
  const words = q.split(/\s+/);
  return (row) => {
    const hay = row.title.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
}

export function matchesText(row: Pick<ViewRow, "number" | "title">, raw: string): boolean {
  return compileText(raw)(row as ViewRow);
}

export function runView(view: View, ctx: ViewContext, rows: ViewRow[]): ViewRow[] {
  const tests = view.filters.map((f) => compileFilter(f, ctx));
  const filtered = rows.filter((r) => tests.every((t) => t(r)));
  const sorted = [...filtered].sort((a, b) => {
    for (const s of view.sort) {
      // Empty values always sort last, independent of direction.
      const ak = sortKey(a, s.field);
      const bk = sortKey(b, s.field);
      if (ak == null && bk == null) continue;
      if (ak == null) return 1;
      if (bk == null) return -1;
      const cmp = compareBy(a, b, s.field, ctx);
      if (cmp !== 0) return s.dir === "asc" ? cmp : -cmp;
    }
    return 0;
  });
  return sorted;
}

function compareBy(a: ViewRow, b: ViewRow, field: string, _ctx: ViewContext): number {
  const av = sortKey(a, field);
  const bv = sortKey(b, field);
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

/**
 * Sort key for a field. Every sortable field resolves to a real value —
 * previously anything outside a short list returned null, which made the
 * comparator return 0 and silently left the rows in their original order.
 * Single-selects sort by option position (the team's intended order), not by
 * the opaque option ID.
 */
function sortKey(row: ViewRow, field: string): string | number | null {
  if (isDimKey(field)) {
    const v = row.dims[dimFieldId(field)];
    return v ? (v.rank ?? Number.MAX_SAFE_INTEGER) : null;
  }
  switch (field) {
    case "priority":
      return row.priorityRank;
    case "status":
      return row.statusRank;
    case "release":
      return row.releaseRank;
    case "type":
      return row.typeName;
    case "label":
      return row.labelNames.length ? row.labelNames.join(", ") : null;
    case "milestone":
      return row.milestoneName;
    case "assignee":
      return row.assignees.length ? row.assignees.join(", ") : null;
    case "parent":
      return row.parentNumber;
    case "progress":
      return progressKey(row);
    case "updated":
      return row.updatedAt;
    case "created":
      return row.createdAt;
    case "number":
      return row.number;
    case "title":
      return row.title;
    case "state":
      return row.state;
    default:
      return null;
  }
}

export type RowGroup = { key: string; label: string; rows: ViewRow[] };

/**
 * Group rows for display. The key stays the GitHub ID (stable across renames,
 * which is what SPEC §4 asks for), while `label` carries the current display
 * name. The previous version returned only IDs, so the views page rendered
 * raw option IDs like "a0000001" as headings.
 */
export function groupRowEntries(rows: ViewRow[], groupBy: string): RowGroup[] {
  const groups = new Map<string, RowGroup>();
  const ensure = (key: string, label: string): RowGroup => {
    let g = groups.get(key);
    if (!g) {
      g = { key, label, rows: [] };
      groups.set(key, g);
    }
    return g;
  };
  for (const r of rows) {
    for (const { key, label } of groupKey(r, groupBy)) {
      ensure(key, label).rows.push(r);
    }
  }
  return [...groups.values()];
}

function groupKey(row: ViewRow, groupBy: string): { key: string; label: string }[] {
  const one = (key: string | null, label: string | null): { key: string; label: string }[] => [
    { key: key ?? "empty", label: label ?? "No value" },
  ];
  if (isDimKey(groupBy)) {
    const v = row.dims[dimFieldId(groupBy)];
    return one(v?.id ?? null, v ? (v.name ?? "Missing option") : null);
  }
  switch (groupBy) {
    case "status":
      return one(row.statusId, row.statusName);
    case "priority":
      return one(row.priorityId, row.priorityName);
    case "release":
      return one(row.releaseId, row.releaseName);
    case "type":
      return one(row.typeId, row.typeName);
    case "milestone":
      return one(row.milestoneId, row.milestoneName);
    case "parent":
      return one(
        row.parentNodeId,
        row.parentNodeId
          ? `#${row.parentNumber ?? "?"} ${row.parentTitle ?? ""}`.trim()
          : null,
      );
    case "assignee":
      return row.assignees.length
        ? row.assignees.map((a) => ({ key: a, label: a }))
        : [{ key: "empty", label: "Unassigned" }];
    case "label":
      return row.labelNames.length
        ? row.labelIds.map((id, i) => ({ key: id, label: row.labelNames[i] ?? id }))
        : [{ key: "empty", label: "No labels" }];
    default:
      return [{ key: "all", label: "All" }];
  }
}
