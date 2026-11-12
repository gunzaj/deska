"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { groupId, rowKey, type NavRow } from "@/lib/client/list-nav";
import { DEFAULT_PROPS, dimensionLabel, type DisplayProp, type Group } from "@/lib/client/explorer";
import { isDimKey } from "@/lib/sync/field-map";
import type { ClientIssue, DimKey } from "@/lib/client/types";
import { Icon } from "../icons";
import { Avatar, OptionDot, PriorityIcon, StatusIcon } from "../props";
import { useAppData } from "../app/provider";
import { useCells } from "./cells";

const ROW_H = 38;
const GROUP_H = 36;

type Flat = { kind: "group"; group: Group; collapsed: boolean } | { kind: "issue"; issue: ClientIssue; key: string };

function useViewport(ref: React.RefObject<HTMLElement | null>) {
  const [vp, setVp] = useState({ top: 0, height: 800 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setVp({ top: el.scrollTop, height: el.clientHeight });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [ref]);
  return vp;
}

function GroupHeader({ group, collapsed, onToggle }: { group: Group; collapsed: boolean; onToggle: () => void }) {
  const { data, option } = useAppData();
  const { meta } = data;
  let icon: ReactNode = null;
  if (group.field === "status") icon = <StatusIcon option={option("status", group.key)} total={meta.fields.status.length} />;
  else if (group.field === "priority") icon = <PriorityIcon option={option("priority", group.key)} total={meta.fields.priority.length} />;
  else if (group.field === "assignee") icon = group.key === "∅" ? <Icon name="user" size={14} className="text-faint" /> : <Avatar login={group.label} size={16} />;
  else if (group.field === "release") icon = <Icon name="calendar" size={14} className="text-faint" />;
  else if (group.field === "parent") icon = <Icon name="epic" size={14} className="text-violet" />;
  else if (group.color !== undefined) icon = <OptionDot color={group.color} />;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex h-full w-full items-center gap-2 border-b border-line bg-bg/70 px-4 text-left text-[12.5px] font-semibold hover:bg-hover"
    >
      <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={13} className="text-faint" />
      {icon}
      <span className="truncate">{group.label}</span>
      <span className="font-normal tabular-nums text-faint">{group.rows.length}</span>
      {group.field === "release" && group.key === meta.currentReleaseId && (
        <span className="rounded-full bg-brand-soft px-1.5 text-[10.5px] font-semibold text-brand-text">Current</span>
      )}
    </button>
  );
}

/**
 * Multi-select for bulk edit (W4): a checkbox per row, Shift+click selects a
 * range, ⌘/Ctrl+click toggles. `click` returns true when it handled the
 * click as a selection, so the row doesn't open.
 */
export type RowSelection = {
  isSelected: (nodeId: string) => boolean;
  /** `key`: the row's place (an issue can show in several groups), the anchor of a Shift+click range. */
  toggle: (issue: ClientIssue, key: string) => void;
  click: (issue: ClientIssue, e: React.MouseEvent, key: string) => boolean;
};

function SelectBox({ issue, rowKey, selection }: { issue: ClientIssue; rowKey: string; selection: RowSelection }) {
  const on = selection.isSelected(issue.nodeId);
  return (
    <input
      type="checkbox"
      aria-label={`Select #${issue.number}`}
      checked={on}
      onChange={() => selection.toggle(issue, rowKey)}
      onClick={(e) => e.stopPropagation()}
      className={`size-3.5 shrink-0 accent-brand ${on ? "" : "opacity-40 group-hover:opacity-100 focus:opacity-100"}`}
    />
  );
}

/**
 * One list row. Memoized: with stable callbacks (`onOpen` and `onFocus` take the
 * issue, so the parent passes one function for every row) only the rows whose
 * issue, focus or selection changed re-render (v5 3.4).
 */
export const IssueRow = memo(function IssueRow({
  issue,
  props,
  focused,
  onOpen,
  onFocus,
  selection,
  tabbable,
  rowKey,
  peeked = false,
}: {
  issue: ClientIssue;
  props: DisplayProp[];
  focused: boolean;
  /** This issue is open in the side panel (improvement 1). */
  peeked?: boolean;
  onOpen: (issue: ClientIssue) => void;
  /** Gets `rowKey` (else the node ID). */
  onFocus: (key: string) => void;
  selection?: RowSelection;
  /** Roving focus (U2): the one row in the list that Tab reaches. */
  tabbable?: boolean;
  /** This row's place in the list, when the issue can show more than once. */
  rowKey?: string;
}) {
  const c = useCells();
  const has = (p: DisplayProp) => props.includes(p);
  const picked = selection?.isSelected(issue.nodeId) ?? false;
  const key = rowKey ?? issue.nodeId;
  return (
    <div
      tabIndex={tabbable ? 0 : -1}
      aria-current={focused ? "true" : undefined}
      data-issue={issue.number}
      data-row-id={issue.nodeId}
      data-row-key={key}
      data-peek-row
      data-peeked={peeked ? "" : undefined}
      onClick={(e) => {
        if (selection?.click(issue, e, key)) return;
        onOpen(issue);
      }}
      onMouseMove={() => onFocus(key)}
      onFocus={() => onFocus(key)}
      className={`group relative flex h-full cursor-default items-center gap-2.5 border-b border-line-soft px-4 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${peeked ? "" : picked ? "bg-brand-soft" : focused ? "bg-hover" : ""}`}
    >
      {focused && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-brand" />}
      {selection && <SelectBox issue={issue} rowKey={key} selection={selection} />}
      {has("priority") && c.priority(issue)}
      {has("id") && <span className="w-[3.75rem] shrink-0">{c.id(issue)}</span>}
      {has("status") && c.status(issue)}
      <span className={`min-w-0 flex-1 truncate font-medium ${issue.state === "closed" ? "text-muted" : ""}`}>
        <span data-peek-title>{issue.title}</span>
      </span>
      {has("subissues") && c.subissues(issue)}
      <span className="hidden min-w-0 shrink items-center gap-1.5 lg:flex">
        {has("labels") && c.labels(issue)}
        {has("parent") && c.parent(issue)}
        {c.dims(issue, props)}
        {has("type") && c.type(issue)}
        {has("milestone") && c.milestone(issue)}
      </span>
      {has("release") && <span className="hidden md:inline-flex">{c.release(issue)}</span>}
      {has("created") && <span className="hidden md:inline">{c.created(issue)}</span>}
      {has("assignee") && c.assignee(issue)}
      {has("updated") && c.updated(issue)}
    </div>
  );
});

/**
 * Keep DOM focus on the focused row while focus is inside the list, so j/k
 * (which move the focused row) move the keyboard focus too (U2).
 */
function useRovingFocus(container: React.RefObject<HTMLElement | null>, focusedKey: string | null) {
  useEffect(() => {
    const root = container.current;
    if (!root || !focusedKey || !root.contains(document.activeElement)) return;
    const el = root.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(focusedKey)}"]`);
    if (el && el !== document.activeElement) el.focus({ preventScroll: true });
  }, [container, focusedKey]);
}

export function ListLayout({
  groups,
  collapsed,
  onToggleGroup,
  props = DEFAULT_PROPS,
  focusedKey,
  onFocus,
  onOpen,
  scrollRef,
  selection,
  peeked = null,
}: {
  groups: Group[];
  /** Collapsed groups (`groupId`). The explorer owns them, so j/k, ⌘A and bulk edit skip hidden rows. */
  collapsed: ReadonlySet<string>;
  onToggleGroup: (g: Group) => void;
  props?: DisplayProp[];
  /** The focused row's place (`rowKey(group, nodeId)`). */
  focusedKey: string | null;
  onFocus: (key: string) => void;
  onOpen: (i: ClientIssue) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  selection?: RowSelection;
  /** The issue open in the side panel (improvement 1). */
  peeked?: number | null;
}) {
  const grouped = !(groups.length === 1 && groups[0]!.key === "all");
  const flat = useMemo<Flat[]>(() => {
    const out: Flat[] = [];
    for (const g of groups) {
      const isCollapsed = collapsed.has(groupId(g));
      if (grouped) out.push({ kind: "group", group: g, collapsed: isCollapsed });
      if (!isCollapsed) for (const i of g.rows) out.push({ kind: "issue", issue: i, key: rowKey(g.key, i.nodeId) });
    }
    return out;
  }, [groups, collapsed, grouped]);
  const tops = useMemo(() => {
    const t: number[] = [];
    let y = 0;
    for (const f of flat) {
      t.push(y);
      y += f.kind === "group" ? GROUP_H : ROW_H;
    }
    t.push(y);
    return t;
  }, [flat]);
  const total = tops[tops.length - 1] ?? 0;
  const vp = useViewport(scrollRef);
  const list = useRef<HTMLDivElement>(null);
  // Roving focus (U2): Tab reaches one row, the focused one or else the first.
  const tabId = useMemo(() => {
    const issues = flat.filter((f): f is Extract<Flat, { kind: "issue" }> => f.kind === "issue");
    return issues.find((f) => f.key === focusedKey)?.key ?? issues[0]?.key ?? null;
  }, [flat, focusedKey]);
  useRovingFocus(list, focusedKey);

  // Binary search the first visible item, then render a small overscan window.
  let lo = 0;
  let hi = flat.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid + 1]! <= vp.top) lo = mid + 1;
    else hi = mid;
  }
  const start = Math.max(0, lo - 8);
  let end = lo;
  while (end < flat.length && tops[end]! < vp.top + vp.height) end++;
  end = Math.min(flat.length, end + 8);

  // Keep the keyboard-focused row in view.
  useEffect(() => {
    if (!focusedKey) return;
    const idx = flat.findIndex((f) => f.kind === "issue" && f.key === focusedKey);
    const el = scrollRef.current;
    if (idx < 0 || !el) return;
    const top = tops[idx]!;
    const bottom = top + ROW_H;
    if (top < el.scrollTop + GROUP_H) el.scrollTop = Math.max(0, top - GROUP_H);
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [focusedKey, flat, tops, scrollRef]);

  return (
    <div ref={list} role="list" aria-label="Issues" style={{ height: total, position: "relative" }}>
      {flat.slice(start, end).map((f, k) => {
        const idx = start + k;
        const style = { position: "absolute" as const, top: tops[idx], left: 0, right: 0, height: f.kind === "group" ? GROUP_H : ROW_H };
        return f.kind === "group" ? (
          <div key={`g:${f.group.key}`} role="listitem" style={style}>
            <GroupHeader
              group={f.group}
              collapsed={f.collapsed}
              onToggle={() => onToggleGroup(f.group)}
            />
          </div>
        ) : (
          <div key={`i:${f.key}`} role="listitem" style={style}>
            <IssueRow
              issue={f.issue}
              rowKey={f.key}
              props={props}
              focused={f.key === focusedKey}
              tabbable={f.key === tabId}
              onOpen={onOpen}
              onFocus={onFocus}
              selection={selection}
              peeked={f.issue.number === peeked}
            />
          </div>
        );
      })}
    </div>
  );
}

// The board lives in ./board.tsx (drag and drop, W3).

// ---------------- Table ----------------

type FixedProp = Exclude<DisplayProp, DimKey>;
const COL_W: Record<FixedProp, number> = {
  id: 76, status: 150, priority: 110, release: 96, type: 96, labels: 200,
  parent: 190, subissues: 120, milestone: 110, assignee: 150, created: 84, updated: 84,
};
const SORTABLE: Partial<Record<FixedProp, string>> = {
  id: "number", status: "status", priority: "priority", release: "release", created: "created", updated: "updated", subissues: "progress",
};
const LABEL: Record<FixedProp, string> = {
  id: "ID", status: "Status", priority: "Priority", release: "Release", type: "Type", labels: "Labels",
  parent: "Epic", subissues: "Progress", milestone: "Milestone", assignee: "Assignee", created: "Created", updated: "Updated",
};
/** Dimension columns (`dim:<fieldId>`) are as wide as a team column was, and sort by themselves. */
const colWidth = (p: DisplayProp) => (isDimKey(p) ? 170 : COL_W[p]);

export function TableLayout({
  rows,
  props = DEFAULT_PROPS,
  sort,
  onSort,
  focusedKey,
  onFocus,
  onOpen,
  scrollRef,
  selection,
  peeked = null,
}: {
  rows: NavRow[];
  props?: DisplayProp[];
  sort: { field: string; dir: "asc" | "desc" }[];
  onSort: (field: string, additive?: boolean) => void;
  focusedKey: string | null;
  onFocus: (key: string) => void;
  onOpen: (i: ClientIssue) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  selection?: RowSelection & { all: boolean; toggleAll: () => void };
  /** The issue open in the side panel (improvement 1). */
  peeked?: number | null;
}) {
  const c = useCells();
  const { meta } = useAppData().data;
  const vp = useViewport(scrollRef);
  const cols = props.filter((p) => p !== "id");
  const SEL = selection ? 32 : 0;
  const width = SEL + 76 + 360 + cols.reduce((s, p) => s + colWidth(p), 0);
  const HEAD = 34;
  const start = Math.max(0, Math.floor((vp.top - HEAD) / ROW_H) - 8);
  const end = Math.min(rows.length, Math.ceil((vp.top + vp.height) / ROW_H) + 8);
  const body = useRef<HTMLDivElement>(null);
  const tabId = rows.find((r) => r.key === focusedKey)?.key ?? rows[0]?.key ?? null;
  useRovingFocus(body, focusedKey);

  useEffect(() => {
    if (!focusedKey) return;
    const idx = rows.findIndex((r) => r.key === focusedKey);
    const el = scrollRef.current;
    if (idx < 0 || !el) return;
    const top = HEAD + idx * ROW_H;
    if (top < el.scrollTop + HEAD) el.scrollTop = top - HEAD;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [focusedKey, rows, scrollRef]);

  const cell = (p: DisplayProp, i: ClientIssue): ReactNode => {
    if (isDimKey(p)) return c.dim(p, i) ?? <span className="text-faint">—</span>;
    switch (p) {
      case "status":
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            {c.status(i)}
            <span className="truncate text-muted">{i.state === "closed" ? "Closed" : (i.statusName ?? "—")}</span>
          </span>
        );
      case "priority":
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            {c.priority(i)}
            <span className="truncate text-muted">{i.priorityName ?? "—"}</span>
          </span>
        );
      case "assignee":
        return i.assignees.length ? (
          <span className="flex min-w-0 items-center gap-1.5">
            {c.assignee(i)}
            <span className="truncate text-muted">{i.assignees.join(", ")}</span>
          </span>
        ) : (
          <span className="text-faint">—</span>
        );
      case "labels":
        return c.labels(i, 3);
      case "id":
        return c.id(i);
      default:
        return (c[p] as (x: ClientIssue) => ReactNode)(i) ?? <span className="text-faint">—</span>;
    }
  };

  const head = (p: DisplayProp | "title") => {
    const key = p === "title" ? "title" : isDimKey(p) ? p : SORTABLE[p];
    const label = p === "title" ? "Title" : isDimKey(p) ? dimensionLabel(meta, p) : LABEL[p];
    const at = key ? sort.findIndex((s) => s.field === key) : -1;
    const active = at >= 0;
    const dir = active ? sort[at]!.dir : null;
    return key ? (
      <button
        type="button"
        onClick={(e) => onSort(key, e.shiftKey)}
        title="Click to sort, Shift-click to add a sort key"
        aria-label={active ? `${label}, sort ${at + 1}${sort.length > 1 ? ` of ${sort.length}` : ""}, ${dir === "asc" ? "ascending" : "descending"}` : `Sort by ${label}`}
        className={`flex items-center gap-1 hover:text-fg ${active ? "text-fg" : ""}`}
      >
        {label}
        {active && <Icon name="chevronDown" size={12} className={dir === "asc" ? "rotate-180" : ""} />}
        {active && sort.length > 1 && <span className="text-[10.5px] text-faint">{at + 1}</span>}
      </button>
    ) : (
      label
    );
  };

  return (
    <div style={{ width: Math.max(width, 0), minWidth: "100%" }} role="table">
      <div role="row" className="sticky top-0 z-10 flex border-b border-line bg-surface text-[11.5px] font-semibold text-faint" style={{ height: HEAD }}>
        {selection && (
          <div role="columnheader" className="flex w-8 shrink-0 items-center justify-end">
            <input type="checkbox" aria-label="Select all visible issues" checked={selection.all} onChange={selection.toggleAll} className="size-3.5 accent-brand" />
          </div>
        )}
        <div role="columnheader" className="flex w-[76px] shrink-0 items-center pl-4">
          {head("id")}
        </div>
        <div role="columnheader" className="flex min-w-[360px] flex-1 items-center px-2">
          {head("title")}
        </div>
        {cols.map((p) => (
          <div key={p} role="columnheader" className="flex shrink-0 items-center px-2" style={{ width: colWidth(p) }}>
            {head(p)}
          </div>
        ))}
      </div>
      <div ref={body} role="rowgroup" style={{ height: rows.length * ROW_H, position: "relative" }}>
        {rows.slice(start, end).map(({ key, issue: i }, k) => {
          const idx = start + k;
          const focused = key === focusedKey;
          const picked = selection?.isSelected(i.nodeId) ?? false;
          return (
            <div
              key={key}
              role="row"
              tabIndex={key === tabId ? 0 : -1}
              aria-current={focused ? "true" : undefined}
              onFocus={() => onFocus(key)}
              data-issue={i.number}
              data-row-id={i.nodeId}
              data-row-key={key}
              data-peek-row
              data-peeked={i.number === peeked ? "" : undefined}
              onClick={(e) => {
                if (selection?.click(i, e, key)) return;
                onOpen(i);
              }}
              onMouseMove={() => onFocus(key)}
              className={`group absolute left-0 right-0 flex items-center border-b border-line-soft text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${i.number === peeked ? "" : picked ? "bg-brand-soft" : focused ? "bg-hover" : ""}`}
              style={{ top: idx * ROW_H, height: ROW_H }}
            >
              {focused && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-brand" />}
              {selection && (
                <div role="cell" className="flex w-8 shrink-0 items-center justify-end">
                  <SelectBox issue={i} rowKey={key} selection={selection} />
                </div>
              )}
              <div role="cell" className="w-[76px] shrink-0 pl-4">
                {c.id(i)}
              </div>
              <div role="cell" className={`min-w-[360px] flex-1 truncate px-2 text-[13px] font-medium ${i.state === "closed" ? "text-muted" : ""}`}>
                <span data-peek-title>{i.title}</span>
              </div>
              {cols.map((p) => (
                <div key={p} role="cell" className="flex shrink-0 items-center overflow-hidden px-2" style={{ width: colWidth(p) }}>
                  {cell(p, i)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
