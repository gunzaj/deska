"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { encodeState, decodeState } from "@/lib/client/explorer";
import { shortAgo } from "@/lib/client/format";
import { CHECKS_LABEL, DECISION_LABEL, groupPrs, PR_FILTER_FIELDS, runPrs, STATE_LABEL } from "@/lib/client/prs";
import type { ClientPr } from "@/lib/client/types";
import { canEditView, newViewId } from "@/lib/views/ids";
import { prViewStateSchema, type PrFilter, type PrFilterField, type PrViewState } from "@/lib/views/pr-view";
import type { View } from "@/lib/views/view";
import { useAppData, useAppViews } from "../app/provider";
import { Page } from "../app/shell";
import { Icon, type IconName } from "../icons";
import { Avatar, EmptyHint, OptionDot } from "../props";
import { useTasks } from "../tasks/store";
import { btn, PickList, Popover, type PickItem } from "../ui/popover";
import { SaveViewDialog } from "../explorer/save-view-dialog";
import { useListKeyboard } from "../explorer/use-list-keyboard";
import { useSearchDraft } from "../explorer/use-search-draft";
import { useUrlExplorerState } from "../explorer/use-url-state";
import { ViewActions } from "../explorer/view-menu";
import { ChecksIcon, DecisionBadge, PrStateIcon } from "./bits";
import { openPr, PR_PARAM } from "./open-pr";
import { usePrs } from "./store";

function useValueOptions() {
  const { data } = useAppData();
  const { prs } = usePrs();
  return useCallback(
    (field: PrFilterField): PickItem[] => {
      const people = [...new Set([...prs.flatMap((p) => [p.author, ...p.reviews.map((r) => r.author), ...p.assignees]), ...data.meta.users.map((u) => u.login)].map((l) => l.toLowerCase()))].sort();
      const peopleItems = [{ id: "me", label: "Me" }, ...people.map((l) => ({ id: l, label: l }))];
      switch (field) {
        case "state":
          return (["open", "draft", "merged", "closed"] as const).map((k) => ({ id: k, label: STATE_LABEL[k] }));
        case "author":
        case "reviewedBy":
        case "assignee":
          return peopleItems;
        case "requested": {
          const teams = [...new Set(prs.flatMap((p) => p.reviewRequests.filter((r) => r.kind === "team").map((r) => r.reviewer.toLowerCase())))].sort();
          return [...peopleItems, ...teams.map((t) => ({ id: `team:${t}`, label: `@${t}`, section: "Teams" }))];
        }
        case "decision":
          return Object.entries(DECISION_LABEL).map(([id, label]) => ({ id, label }));
        case "checks":
          return Object.entries(CHECKS_LABEL).map(([id, label]) => ({ id, label }));
        case "label":
          return data.meta.labels.map((l) => ({ id: l.id, label: l.name, icon: <OptionDot color={l.color} /> }));
        case "milestone":
          return data.meta.milestones.map((m) => ({ id: m.id, label: m.title }));
        case "linked":
          return [
            { id: "yes", label: "Closes an issue" },
            { id: "no", label: "No linked issue" },
          ];
      }
    },
    [data.meta, prs],
  );
}

function FilterChip({ filter, onChange, onRemove }: { filter: Exclude<PrFilter, { field: "text" }>; onChange: (values: string[]) => void; onRemove: () => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const options = useValueOptions()(filter.field);
  const def = PR_FILTER_FIELDS.find((f) => f.key === filter.field)!;
  const label = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  const values = filter.values as string[];
  return (
    <span className="inline-flex h-7 items-center rounded-md border border-line bg-surface text-[12.5px] shadow-raised">
      <button ref={anchor} type="button" onClick={() => setOpen(true)} className="flex h-full items-center gap-1.5 rounded-l-md px-2 hover:bg-hover">
        <Icon name={def.icon as IconName} size={12} className="text-faint" />
        <span className="text-muted">{def.label}</span>
        <span className="max-w-[14rem] truncate font-medium">{values.length ? values.map(label).join(", ") : "any"}</span>
      </button>
      <button type="button" onClick={onRemove} aria-label={`Remove ${def.label} filter`} className="grid h-full w-6 place-items-center rounded-r-md border-l border-line text-faint hover:bg-hover hover:text-fg">
        <Icon name="x" size={11} />
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={260}>
        <PickList
          multi
          items={options.map((o) => ({ ...o, checked: values.includes(o.id) }))}
          placeholder={`${def.label}…`}
          onPick={(id) => onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id])}
        />
      </Popover>
    </span>
  );
}

function AddFilter({ onAdd }: { onAdd: (field: PrFilterField, value: string) => void }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<PrFilterField | null>(null);
  const options = useValueOptions();
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => {
          setField(null);
          setOpen(true);
        }}
        className={btn.ghost}
      >
        <Icon name="filter" size={13} /> Filter
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={260}>
        {field ? (
          <PickList
            key={field}
            items={options(field)}
            placeholder={`${PR_FILTER_FIELDS.find((f) => f.key === field)!.label}…`}
            onPick={(id) => {
              onAdd(field, id);
              setOpen(false);
            }}
          />
        ) : (
          <PickList items={PR_FILTER_FIELDS.map((f) => ({ id: f.key, label: f.label, icon: <Icon name={f.icon as IconName} size={13} className="text-faint" /> }))} placeholder="Filter by…" onPick={(id) => setField(id as PrFilterField)} />
        )}
      </Popover>
    </>
  );
}

/**
 * Chips for each PR filter plus "+ Filter". The state filter has its own
 * control in the explorer, so it gets a chip only with `withState`.
 */
export function PrFilterChips({ filters, onChange, withState = false }: { filters: PrFilter[]; onChange: (f: PrFilter[]) => void; withState?: boolean }) {
  return (
    <>
      {filters.map((f, i) =>
        f.field === "text" || (f.field === "state" && !withState) ? null : (
          <FilterChip
            key={`${f.field}-${i}`}
            filter={f}
            onChange={(values) => onChange(filters.map((x, j) => (j === i ? ({ ...f, values } as PrFilter) : x)))}
            onRemove={() => onChange(filters.filter((_, j) => j !== i))}
          />
        ),
      )}
      <AddFilter
        onAdd={(field, value) => {
          const i = filters.findIndex((f) => f.field === field);
          if (i >= 0) {
            const f = filters[i] as Exclude<PrFilter, { field: "text" }>;
            const values = [...new Set([...(f.values as string[]), value])];
            onChange(filters.map((x, j) => (j === i ? ({ ...f, values } as PrFilter) : x)));
          } else onChange([...filters, { field, values: [value] } as PrFilter]);
        }}
      />
    </>
  );
}

/**
 * One PR row. Memoized: `active` (the PR open in the side panel) comes from the
 * parent, which reads the URL once, instead of every row subscribing to it, and
 * `onFocus` takes the node ID, so one function serves every row (v5 3.4, 3.10).
 */
export const PrRow = memo(function PrRow({ pr, focused, active, onFocus }: { pr: ClientPr; focused: boolean; active: boolean; onFocus: (nodeId: string) => void }) {
  const { avatarOf, byNodeId } = useAppData();
  const linked = pr.closingIssues.map((id) => byNodeId.get(id)).filter((i): i is NonNullable<typeof i> => i != null);
  return (
    <li
      role="option"
      aria-selected={focused}
      tabIndex={focused ? 0 : -1}
      onMouseEnter={() => onFocus(pr.nodeId)}
      onFocus={() => onFocus(pr.nodeId)}
      data-peek-row
      data-pr={pr.number}
      onClick={() => openPr(pr.number)}
      // Rows off screen skip layout and paint: "All" lists ~2.6k of them.
      className={`group flex h-11 cursor-pointer items-center gap-3 border-b border-line-soft px-4 [contain-intrinsic-size:auto_44px] [content-visibility:auto] ${active ? "bg-active" : focused ? "bg-hover" : "hover:bg-hover"}`}
    >
      <PrStateIcon pr={pr} />
      <span className="w-14 shrink-0 font-mono text-[11.5px] tabular-nums text-faint">#{pr.number}</span>
      <span className="min-w-0 flex-1 truncate text-[13.5px]">
        <span data-peek-title>{pr.title}</span>
      </span>
      {linked.slice(0, 1).map((i) => (
        <span key={i.nodeId} className="hidden max-w-[12rem] items-center gap-1 truncate text-[12px] text-faint lg:inline-flex" title={`Closes #${i.number} ${i.title}`}>
          <Icon name="link" size={11} />#{i.number}
        </span>
      ))}
      <DecisionBadge decision={pr.state === "open" ? pr.reviewDecision : null} />
      <ChecksIcon state={pr.state === "open" ? pr.checksState : null} />
      <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-faint">{shortAgo(pr.updatedAt)}</span>
      <Avatar login={pr.author} url={avatarOf(pr.author)} size={20} />
    </li>
  );
});

function PrTable({ rows, focusedId, onFocus }: { rows: ClientPr[]; focusedId: string | null; onFocus: (id: string) => void }) {
  const { avatarOf } = useAppData();
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead className="sticky top-0 z-10 bg-surface text-left text-[11.5px] text-faint">
        <tr className="border-b border-line">
          {["", "#", "Title", "Author", "Reviews", "Checks", "Changes", "Updated"].map((h) => (
            <th key={h} className="h-8 px-3 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.nodeId} data-peek-row onMouseEnter={() => onFocus(p.nodeId)} onClick={() => openPr(p.number)} className={`h-10 cursor-pointer border-b border-line-soft ${focusedId === p.nodeId ? "bg-hover" : "hover:bg-hover"}`}>
            <td className="w-8 px-3">
              <PrStateIcon pr={p} />
            </td>
            <td className="w-16 px-3 font-mono text-[11.5px] text-faint">#{p.number}</td>
            <td className="max-w-0 truncate px-3">
              <span data-peek-title>{p.title}</span>
            </td>
            <td className="px-3">
              <span className="inline-flex items-center gap-1.5">
                <Avatar login={p.author} url={avatarOf(p.author)} size={18} />
                {p.author}
              </span>
            </td>
            <td className="px-3">
              <DecisionBadge decision={p.reviewDecision} />
            </td>
            <td className="px-3">
              <ChecksIcon state={p.checksState} />
            </td>
            <td className="px-3 text-[12px] tabular-nums">
              <span className="text-[#1f883d]">+{p.additions}</span> <span className="text-critical">−{p.deletions}</span>
            </td>
            <td className="px-3 text-[12px] text-faint">{shortAgo(p.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const GROUPS: { key: PrViewState["groupBy"]; label: string }[] = [
  { key: "", label: "No grouping" },
  { key: "state", label: "State" },
  { key: "decision", label: "Review decision" },
  { key: "checks", label: "Checks" },
  { key: "author", label: "Author" },
  { key: "label", label: "Label" },
];

function readPrState(raw: string | null): PrViewState | null {
  const parsed = prViewStateSchema.safeParse(decodeState(raw));
  return parsed.success ? parsed.data : null;
}
const encodePrState = (s: PrViewState) => encodeState(s as never);
const samePrState = (a: PrViewState, b: PrViewState) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The PR lens (SPEC §13.3): filters, grouping, list/table, URL state and saved
 * views. A sibling of the issue explorer sharing its building blocks.
 */
export function PrExplorer({ title, icon, defaults, view, empty }: { title: string; icon: ReactNode; defaults: PrViewState; view?: View; empty?: { title: string; hint: string } }) {
  const { data, viewer } = useAppData();
  const { upsertView } = useAppViews();
  const { prs, loaded, ctx, error: loadError, retry } = usePrs();
  const { openCompose } = useTasks();
  const router = useRouter();
  const params = useSearchParams();
  const activePr = params.get(PR_PARAM);
  const saved = useMemo(() => view?.pr ?? defaults, [view, defaults]);
  const [state, setState] = useUrlExplorerState<PrViewState>({
    saved,
    savedKey: view?.id ?? JSON.stringify(defaults),
    decode: readPrState,
    encode: encodePrState,
    same: samePrState,
  });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "new" | "rename">(null);
  const search = useRef<HTMLInputElement>(null);

  const text = state.filters.find((f): f is Extract<PrFilter, { field: "text" }> => f.field === "text")?.value ?? "";
  // The search box types into a draft; the filter (and the URL) follow 120 ms
  // later, so a keystroke does not re-filter ~2.6k PRs (v5 3.10).
  const [draft, setDraft] = useSearchDraft(text, (v) => {
    const rest = state.filters.filter((f) => f.field !== "text");
    setState({ ...state, filters: v ? [...rest, { field: "text", value: v }] : rest });
  });
  const rows = useMemo(() => runPrs(prs, state, ctx), [prs, state, ctx]);
  const labelName = useCallback((id: string) => data.meta.labels.find((l) => l.id === id)?.name ?? id, [data.meta.labels]);
  const groups = useMemo(() => groupPrs(rows, state.layout === "list" ? state.groupBy : "", labelName), [rows, state.groupBy, state.layout, labelName]);
  const order = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const modified = !samePrState(state, saved);

  const stateValue = (() => {
    const f = state.filters.find((x) => x.field === "state");
    const v = f && f.field === "state" ? [...f.values].sort().join(",") : "";
    return v === "draft,open" ? "open" : v === "merged" ? "merged" : v === "closed" ? "closed" : v === "" ? "all" : "custom";
  })();
  const setStateFilter = (k: "open" | "merged" | "closed" | "all") => {
    const rest = state.filters.filter((f) => f.field !== "state");
    const values = k === "open" ? (["open", "draft"] as const) : k === "merged" ? (["merged"] as const) : k === "closed" ? (["closed"] as const) : null;
    setState({ ...state, filters: values ? [{ field: "state", values: [...values] }, ...rest] : rest });
  };

  useListKeyboard({
    order,
    focusedId,
    setFocusedId,
    searchRef: search,
    onMoved: (next) => {
      // j/k used to move the highlight off-screen without following it.
      requestAnimationFrame(() => document.querySelector(`[data-pr="${next.number}"]`)?.scrollIntoView({ block: "nearest" }));
      if (new URL(window.location.href).searchParams.has(PR_PARAM)) openPr(next.number);
    },
    onKey: (e, idx) => {
      // Escape clears the focused row, so Tab can leave the list again.
      if (e.key === "Escape") {
        setFocusedId(null);
        return;
      }
      if (idx >= 0 && (e.key === "Enter" || e.key === "o" || e.key === "t")) {
        e.preventDefault();
        const p = order[idx]!;
        if (e.key === "o") {
          if (!data.meta.demo) window.open(p.url, "_blank", "noopener");
        }
        else if (e.key === "t") openCompose({ links: [p.number] });
        else openPr(p.number);
      }
    },
  });

  // Only the owner edits a view; others save their changes as a copy (Q6).
  const mine = !view || canEditView(view.ownerId, viewer);
  const saveAs = async (name: string, visibility: View["visibility"]) => {
    const next: View = { id: newViewId(), name, ownerId: viewer, visibility, layout: state.layout, filters: [], sort: [], entity: "pr", pr: state };
    const savedView = await upsertView(next);
    setDialog(null);
    if (savedView) router.push(`/views/${savedView.id}`);
  };
  const saveCurrent = async () => {
    if (!view) return;
    if (await upsertView({ ...view, layout: state.layout, pr: state })) {
      const url = new URL(window.location.href);
      url.searchParams.delete("s");
      window.history.replaceState(null, "", url);
    }
  };
  const select = "h-7 rounded-md border border-line bg-surface px-1.5 text-[12.5px] text-muted outline-none";

  return (
    <Page
      title={
        <span className="flex items-center gap-1.5">
          {title}
          {modified && <span title="Unsaved changes" className="size-1.5 rounded-full bg-brand-border" />}
        </span>
      }
      icon={icon}
      actions={
        <>
          <select aria-label="Group by" value={state.groupBy} onChange={(e) => setState({ ...state, groupBy: e.target.value as PrViewState["groupBy"] })} className={select} disabled={state.layout === "table"}>
            {GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
          <select aria-label="Sort" value={`${state.sort}:${state.dir}`} onChange={(e) => { const [sort, dir] = e.target.value.split(":") as [PrViewState["sort"], PrViewState["dir"]]; setState({ ...state, sort, dir }); }} className={select}>
            <option value="updated:desc">Recently updated</option>
            <option value="created:desc">Newest</option>
            <option value="created:asc">Oldest</option>
            <option value="number:desc">Number</option>
          </select>
          <div className="flex rounded-md border border-line p-px" role="radiogroup" aria-label="Layout">
            {(["list", "table"] as const).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={state.layout === l} title={l === "list" ? "List" : "Table"} onClick={() => setState({ ...state, layout: l })} className={`grid size-6 place-items-center rounded ${state.layout === l ? "bg-active text-fg" : "text-faint hover:text-fg"}`}>
                <Icon name={l} size={13} />
              </button>
            ))}
          </div>
          <ViewActions view={view} mine={mine} modified={modified} onReset={() => setState(saved)} onSave={saveCurrent} onOpenDialog={setDialog} />
        </>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-md border border-line p-px" role="radiogroup" aria-label="PR state">
            {(["open", "merged", "closed", "all"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={stateValue === k} onClick={() => setStateFilter(k)} className={`h-6 rounded px-2 text-[12px] font-medium ${stateValue === k ? "bg-active text-fg" : "text-muted hover:text-fg"}`}>
                {k === "all" ? "All" : STATE_LABEL[k]}
              </button>
            ))}
          </div>
          <label className="flex h-7 w-full items-center gap-1.5 rounded-md border border-line bg-field px-2 focus-within:border-focus sm:w-56">
            <Icon name="search" size={13} className="text-faint" />
            <input
              ref={search}
              aria-label="Search pull requests"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search #, title, branch…"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
            />
          </label>
          <PrFilterChips filters={state.filters} onChange={(filters) => setState({ ...state, filters })} />
          <span className="ml-auto text-[12px] tabular-nums text-faint">{loaded ? `${rows.length} pull request${rows.length === 1 ? "" : "s"}` : loadError ? "" : "Loading…"}</span>
        </div>
      }
    >
      {loaded && loadError && (
        <div role="status" className="flex items-center gap-2 border-b border-line bg-warning-soft px-4 py-1.5 text-[12.5px]">
          <span className="min-w-0 flex-1">Couldn&apos;t refresh pull requests ({loadError}).</span>
          <button type="button" onClick={() => void retry()} className="rounded-md px-2 py-0.5 font-medium hover:bg-hover">
            Retry
          </button>
        </div>
      )}
      {!loaded && loadError ? (
        <EmptyHint
          icon="git"
          title="Couldn't load pull requests"
          hint={loadError}
          action={
            <button type="button" onClick={() => void retry()} className="inline-flex h-8 items-center rounded-md bg-brand px-3 font-semibold text-brand-on hover:bg-brand-hover">
              Retry
            </button>
          }
        />
      ) : loaded && rows.length === 0 ? (
        <EmptyHint icon="git" title={empty?.title ?? "No pull requests match"} hint={empty?.hint ?? "Try another state or remove a filter."} />
      ) : state.layout === "table" ? (
        <PrTable rows={order} focusedId={focusedId} onFocus={setFocusedId} />
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-label={g.label || "Pull requests"}>
            {g.label && (
              <h2 className="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-line bg-surface px-4 text-[12px] font-semibold text-muted">
                {g.label}
                <span className="font-normal tabular-nums text-faint">{g.rows.length}</span>
              </h2>
            )}
            <ul role="listbox" aria-label={g.label || "Pull requests"}>
              {g.rows.map((p) => (
                <PrRow key={p.nodeId} pr={p} focused={focusedId === p.nodeId} active={activePr === String(p.number)} onFocus={setFocusedId} />
              ))}
            </ul>
          </section>
        ))
      )}
      <SaveViewDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === "rename" ? "Rename view" : view ? "Duplicate view" : "Save PR view"}
        initialName={dialog === "rename" ? (view?.name ?? "") : view ? `${view.name} (copy)` : ""}
        initialVisibility={view?.visibility ?? "personal"}
        onSave={async (name, visibility) => {
          if (dialog === "rename" && view) {
            await upsertView({ ...view, name, visibility });
            setDialog(null);
          } else await saveAs(name, visibility);
        }}
      />
    </Page>
  );
}
