"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { EDITING_OFF } from "@/lib/client/edit";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_PROPS,
  sortOptions,
  CARD_PAGE,
  applyState,
  boardColumns,
  decodeState,
  encodeState,
  groupIssues,
  runExplorer,
  sameState,
  stateOf,
  type DisplayProp,
  type ExplorerState,
} from "@/lib/client/explorer";
import dynamic from "next/dynamic";
import { plainName, pluralize } from "@/lib/client/format";
import { withDefaultScope } from "@/lib/client/team-scope";
import { ISSUE_LIST_KEYS } from "@/lib/client/shortcuts";
import { toggleSortKey } from "@/lib/client/sort";
import type { ClientIssue } from "@/lib/client/types";
import { newViewId } from "@/lib/views/ids";
import { viewSchema, type Filter, type View } from "@/lib/views/view";
import Link from "next/link";
import { Page } from "../app/shell";
import { connectionProblem, problemHint, useConnection } from "../app/connection";
import { useAppData, useAppViews } from "../app/provider";
import { peekedIssue, useOpenIssue } from "../app/open-issue";
import { Icon } from "../icons";
import { EmptyHint, Kbd } from "../props";
import { useTasks } from "../tasks/store";
import { DisplayMenu } from "./display-menu";
import { AddFilter, FilterChips } from "./filter-bar";
import { keyboardBusy } from "@/lib/client/keyboard";

// The board and @dnd-kit load when a board is first shown, not with every route (v5 3.9).
const BoardLayout = dynamic(() => import("./board").then((m) => m.BoardLayout), {
  ssr: false,
  loading: () => <p role="status" className="p-6 text-muted">Loading board…</p>,
});
import { BulkBar } from "./bulk";
import { ListLayout, TableLayout, type RowSelection } from "./layouts";
import { rangeIds } from "@/lib/client/bulk";
import { useDefaultScope } from "../app/team-scope";
import { useNarrow } from "../app/use-narrow";
import { openPicker } from "../issue/field-picker";
import { useToast } from "../ui/toast";
import { SaveViewDialog } from "./save-view-dialog";
import { useListKeyboard } from "./use-list-keyboard";
import { useSearchDraft } from "./use-search-draft";
import { useUrlExplorerState } from "./use-url-state";
import { ViewActions } from "./view-menu";

const stateSchema = viewSchema.pick({ filters: true, sort: true, groupBy: true, layout: true, boardColumnsField: true, columns: true });

function readUrlState(raw: string | null): ExplorerState | null {
  const parsed = stateSchema.safeParse(decodeState(raw));
  return parsed.success ? (parsed.data as ExplorerState) : null;
}

/** One array for every caller that passes no `base`: a fresh `[]` per render defeated the row memo below. */
const NO_FILTERS: Filter[] = [];

export function Explorer({
  title,
  icon,
  base = NO_FILTERS,
  defaults,
  view,
  headerExtra,
  summary,
  hideIds,
  emptyTitle = "No issues here",
  emptyHint,
  dropRelease,
}: {
  title: ReactNode;
  icon?: ReactNode;
  /** Locked filters that define the page (hidden from the chip bar). */
  base?: Filter[];
  defaults: ExplorerState;
  view?: View;
  headerExtra?: ReactNode;
  summary?: ReactNode;
  /** Issues kept out of the list (the viewer's triage snoozes, F3). */
  hideIds?: ReadonlySet<string>;
  emptyTitle?: string;
  emptyHint?: ReactNode;
  /** On a board: the Release a card dragged in from the Backlog drawer gets (W3). */
  dropRelease?: string;
}) {
  const { data } = useAppData();
  const { status: connection } = useConnection();
  const { upsertView } = useAppViews();
  const { toast } = useToast();
  const { openCompose } = useTasks();
  const router = useRouter();
  const params = useSearchParams();
  const openIssue = useOpenIssue();
  const saved = useMemo<ExplorerState>(() => (view ? stateOf(view) : defaults), [view, defaults]);
  const [state, setState] = useUrlExplorerState<ExplorerState>({
    saved,
    savedKey: view?.id ?? JSON.stringify(defaults),
    decode: readUrlState,
    encode: encodeState,
    same: sameState,
  });

  // Search box: debounced into a `text` filter.
  const textValue = (state.filters.find((f) => f.field === "text") as { value?: string } | undefined)?.value ?? "";
  const [q, setQ] = useSearchDraft(textValue, (want) => {
    const rest = state.filters.filter((f) => f.field !== "text");
    setState({ ...state, filters: want ? [...rest, { field: "text", op: "contains", value: want }] : rest });
  });

  const pool = useMemo(() => {
    const all = base.length ? runExplorer(data.issues, base, [], data.meta) : data.issues;
    return hideIds?.size ? all.filter((i) => !hideIds.has(i.nodeId)) : all;
  }, [data, base, hideIds]);
  // "Show failed" after a bulk edit narrows the list to those issues (W4).
  const [onlyIds, setOnlyIds] = useState<Set<string> | null>(null);
  // The viewer's default dimension value (user menu), unless the page already says something about that dimension.
  const teamScope = useDefaultScope();
  const rows = useMemo(() => {
    const filters = withDefaultScope(state.filters, base, teamScope.scope);
    const r = runExplorer(pool, filters, state.sort.length ? state.sort : [{ field: "updated", dir: "desc" }], data.meta);
    return onlyIds ? r.filter((i) => onlyIds.has(i.nodeId)) : r;
  }, [pool, state.filters, state.sort, data.meta, onlyIds, base, teamScope.scope]);
  // Below md a table falls back to the list: a display fallback, the URL state keeps "table" (U4).
  const narrow = useNarrow();
  const layout = state.layout === "table" && narrow ? "list" : state.layout;
  const groups = useMemo(() => groupIssues(rows, layout === "list" ? state.groupBy : undefined, data.meta), [rows, state.groupBy, layout, data.meta]);
  // j/k walk rows as shown: down each board column in turn, or down the (grouped) list.
  const order = useMemo(
    // The board renders CARD_PAGE cards per column: j/k must not land on one that is not there (v5 3.10).
    () => (layout === "board" ? boardColumns(rows, state.boardColumnsField ?? "status", data.meta).flatMap((g) => g.rows.slice(0, CARD_PAGE)) : groups.flatMap((g) => g.rows)),
    [layout, state.boardColumnsField, rows, groups, data.meta],
  );
  const props = (state.columns ?? DEFAULT_PROPS) as DisplayProp[];

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Multi-select for bulk edit (W4): list and table, writes on.
  const selectable = data.meta.writeMode && layout !== "board";
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const orderIds = useMemo(() => order.map((r) => r.nodeId), [order]);
  const toggleOne = useCallback((nodeId: string) => {
    anchor.current = nodeId;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);
  const selection = useMemo<RowSelection | undefined>(
    () =>
      selectable
        ? {
            isSelected: (id) => selected.has(id),
            toggle: (i) => toggleOne(i.nodeId),
            click: (i, e) => {
              if (e.shiftKey) {
                e.preventDefault();
                const range = rangeIds(orderIds, anchor.current, i.nodeId);
                setSelected((prev) => new Set([...prev, ...range]));
                anchor.current = i.nodeId;
                return true;
              }
              if (e.metaKey || e.ctrlKey) {
                toggleOne(i.nodeId);
                return true;
              }
              return false;
            },
          }
        : undefined,
    [selectable, selected, toggleOne, orderIds],
  );
  const selectedIssues = useMemo(() => data.issues.filter((i) => selected.has(i.nodeId)), [data.issues, selected]);
  const searchRef = useRef<HTMLInputElement>(null);
  const open = useCallback((i: ClientIssue) => openIssue(i.number), [openIssue]);

  useListKeyboard({
    order,
    focusedId,
    setFocusedId,
    searchRef,
    // With the side panel open, j/k walk through issues in it.
    onMoved: (next) => {
      if (peekedIssue() != null) openIssue(next.number);
    },
    // ⌘A / Ctrl+A selects the visible rows (W4), outside text fields.
    onChord: (e) => {
      if (!(selectable && (e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "a" && !keyboardBusy(e))) return false;
      e.preventDefault();
      setSelected(new Set(orderIds));
      return true;
    },
    onKey: (e, idx) => {
      if (selectable && e.key === "Escape" && selected.size && peekedIssue() == null) {
        setSelected(new Set());
        return;
      }
      const action = ISSUE_LIST_KEYS[e.key];
      if (idx < 0) return;
      if (action === "select") {
        if (!selectable) return;
        e.preventDefault();
        toggleOne(order[idx]!.nodeId);
      } else if (action === "task") {
        // Add the focused issue to tasks: quick add with it attached (§12.4).
        e.preventDefault();
        openCompose({ links: [order[idx]!.number] });
      } else if (action === "open" || action === "github") {
        e.preventDefault();
        const i = order[idx]!;
        if (action === "github") {
          if (!data.meta.demo) window.open(i.url, "_blank", "noopener");
        } else open(i);
      } else if (action === "assign" || action === "priority" || action === "release") {
        e.preventDefault();
        const i = order[idx]!;
        if (!data.meta.writeMode) {
          toast({ message: data.meta.editOffReason ?? EDITING_OFF });
          return;
        }
        // The pickers live in the issue panel: open it, then ask for the picker.
        const field = action === "assign" ? "assignees" : action;
        if (peekedIssue() !== i.number) openIssue(i.number);
        window.setTimeout(() => openPicker(i.nodeId, field), peekedIssue() === i.number ? 0 : 150);
      }
    },
  });

  // Keep the list highlight on the issue shown in the side panel.
  const peek = params.get("issue");
  useEffect(() => {
    const n = Number(peek);
    if (!n) return;
    const hit = order.find((r) => r.number === n);
    if (hit) setFocusedId(hit.nodeId);
  }, [peek, order]);

  // Saving
  const [dialog, setDialog] = useState<null | "new" | "rename">(null);
  const modified = !!view && !sameState(state, saved);
  const saveAs = async (name: string) => {
    const v: View = {
      id: newViewId(),
      name,
      ...state,
      filters: view ? state.filters : [...base, ...state.filters],
    };
    const res = await upsertView(v);
    setDialog(null);
    if (res) router.push(`/views/${res.id}`);
  };
  const saveCurrent = async () => {
    if (!view) return;
    const res = await upsertView(applyState(view, state));
    if (res) {
      const url = new URL(window.location.href);
      url.searchParams.delete("s");
      window.history.replaceState(null, "", url);
    }
  };

  const toggleSort = (field: string, additive = false) => {
    const def = sortOptions(data.meta).find((s) => s.key === field)?.defaultDir ?? "asc";
    setState({ ...state, sort: toggleSortKey(state.sort, field, def, additive) });
  };

  const actions = (
    <>
      {headerExtra}
      <ViewActions
        view={view}
        modified={modified}
        onReset={() => setState(saved)}
        onSave={saveCurrent}
        onOpenDialog={setDialog}
      />
    </>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="flex h-7 w-full items-center gap-1.5 rounded-md border border-line bg-field px-2 focus-within:border-focus sm:w-56">
        <Icon name="search" size={13} className="text-faint" />
        <input
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (q) setQ("");
              else e.currentTarget.blur();
            }
            if (e.key === "ArrowDown" || e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
              if (order[0]) setFocusedId(order[0].nodeId);
            }
          }}
          placeholder="Search title or #number"
          aria-label="Search issues"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
        />
        {!q && <Kbd>/</Kbd>}
      </label>
      {onlyIds && (
        <button type="button" onClick={() => setOnlyIds(null)} aria-label="Show all issues again" className="flex h-7 items-center gap-1.5 rounded-md border border-critical bg-critical-soft px-2 text-[12px] font-medium text-critical">
          Failed edits ({onlyIds.size})
          <Icon name="x" size={12} />
        </button>
      )}
      {teamScope.defaultScope && withDefaultScope([], base, teamScope.defaultScope).length > 0 && !state.filters.some((f) => f.field === teamScope.defaultScope!.dimension.key) && (
        <button
          type="button"
          data-team-scope-chip
          aria-pressed={!teamScope.off}
          onClick={() => teamScope.setOff(!teamScope.off)}
          title={teamScope.off ? `Filter by your default ${teamScope.defaultScope.dimension.name} again` : `Showing your default ${teamScope.defaultScope.dimension.name} only. Click to show all.`}
          className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium ${teamScope.off ? "border-line text-faint hover:text-fg" : "border-brand-border bg-brand-soft text-brand-text"}`}
        >
          {teamScope.off ? `All: ${teamScope.defaultScope.dimension.name}` : `${teamScope.defaultScope.dimension.name}: ${plainName(teamScope.defaultScope.name) || teamScope.defaultScope.name}`}
          <Icon name={teamScope.off ? "plus" : "x"} size={12} />
        </button>
      )}
      <FilterChips filters={state.filters} onChange={(f) => setState({ ...state, filters: f })} pool={pool} />
      <AddFilter filters={state.filters} onChange={(f) => setState({ ...state, filters: f })} pool={pool} />
      {state.filters.some((f) => f.field !== "state") && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            setState({ ...state, filters: state.filters.filter((f) => f.field === "state") });
          }}
          className="h-7 rounded-md px-2 text-[12px] text-faint hover:text-fg"
        >
          Clear
        </button>
      )}
      <span className="ml-auto flex items-center gap-2">
        <span className="text-[12px] tabular-nums text-faint">{pluralize(rows.length, "issue")}</span>
        <DisplayMenu state={state} onChange={setState} />
      </span>
    </div>
  );

  return (
    <Page
      title={
        <span className="flex items-center gap-1.5">
          {title}
          {modified && <span title="Unsaved changes" className="size-1.5 rounded-full bg-brand-border" />}
        </span>
      }
      icon={icon}
      actions={actions}
      toolbar={toolbar}
      summary={summary}
    >
      <div ref={scrollRef} className="absolute inset-0 overflow-auto">
        {rows.length === 0 && connectionProblem(connection) ? (
          // An error is never an empty list (SPEC §3.3).
          <EmptyHint
            icon="alert"
            title={connection!.message ?? "Can't load issues from GitHub"}
            hint={problemHint(connection!) ?? undefined}
            action={
              <Link href="/settings" className="inline-flex h-8 items-center rounded-md border border-line px-3 font-medium hover:bg-hover">
                Open Settings
              </Link>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyHint
            icon="search"
            title={state.filters.length ? "No issues match these filters" : emptyTitle}
            hint={emptyHint ?? (state.filters.length ? "Try removing a filter or showing closed issues." : undefined)}
          />
        ) : layout === "board" ? (
          <BoardLayout rows={rows} field={state.boardColumnsField ?? "status"} props={props} focusedId={focusedId} onFocus={setFocusedId} onOpen={open} dropRelease={dropRelease} />
        ) : layout === "table" ? (
          <TableLayout
            rows={order}
            props={props}
            sort={state.sort}
            onSort={toggleSort}
            focusedId={focusedId}
            onFocus={setFocusedId}
            onOpen={open}
            scrollRef={scrollRef}
            selection={
              selection && {
                ...selection,
                all: orderIds.length > 0 && orderIds.every((id) => selected.has(id)),
                toggleAll: () => setSelected((prev) => (orderIds.every((id) => prev.has(id)) ? new Set() : new Set(orderIds))),
              }
            }
          />
        ) : (
          <ListLayout groups={groups} props={props} focusedId={focusedId} onFocus={setFocusedId} onOpen={open} scrollRef={scrollRef} selection={selection} />
        )}
      </div>
      {selectable && selectedIssues.length > 0 && (
        <BulkBar
          selected={selectedIssues}
          onClear={() => setSelected(new Set())}
          onShowFailed={(ids) => {
            setOnlyIds(new Set(ids));
            setSelected(new Set(ids));
          }}
        />
      )}
      <SaveViewDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === "rename" ? "Rename view" : view ? "Duplicate view" : "Save as view"}
        initialName={dialog === "rename" ? (view?.name ?? "") : view ? `${view.name} (copy)` : typeof title === "string" ? title : ""}
        onSave={async (name) => {
          if (dialog === "rename" && view) {
            await upsertView({ ...view, name });
            setDialog(null);
          } else await saveAs(name);
        }}
      />
    </Page>
  );
}
