"use client";

// Relationships in the issue panel, as in GitHub's issue sidebar: one section
// listing the parent issue, "Blocked by", "Blocking" and "Relates to", and one
// menu to change them (⌥⇧P, B B, B X, B R). Edits go through the outbox like
// any other field (SPEC §4.8); the dependency lists are read live, since sync
// doesn't cache them.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Delta } from "@/lib/client/edit";
import { PROGRESS_TOOLTIP, progressText, subProgress } from "@/lib/client/progress";
import { searchIssues, selfAndDescendants } from "@/lib/client/relations";
import type { ClientIssue } from "@/lib/client/types";
import type { RelatedIssue, Relations } from "@/lib/server/relationships";
import { useAppData } from "../app/provider";
import { peekedIssue, useOpenIssue } from "../app/open-issue";
import { Icon } from "../icons";
import { Kbd } from "../props";
import { PickList, Popover, type PickItem } from "../ui/popover";
import { useToast } from "../ui/toast";
import { useIssueEdits } from "./edits";

const REMOVE = "__remove";

/** The four ways to link an issue, as in GitHub's Relationships menu. */
export type RelationMode = "parent" | "blockedBy" | "blocking" | "relatesTo";
type ListMode = Exclude<RelationMode, "parent">;

/** Fired by the ⌥⇧P / B B / B X / B R shortcuts: the open issue's Relationships section takes it. */
export const RELATION_EVENT = "deska:relation";
export function requestRelation(mode: RelationMode) {
  window.dispatchEvent(new CustomEvent(RELATION_EVENT, { detail: { mode, number: peekedIssue() } }));
}

export const RELATION_MENU: { mode: RelationMode; keys: string[]; heading: string }[] = [
  { mode: "parent", keys: ["⌥", "⇧", "P"], heading: "Parent issue" },
  { mode: "blockedBy", keys: ["B", "B"], heading: "Blocked by" },
  { mode: "blocking", keys: ["B", "X"], heading: "Blocking" },
  { mode: "relatesTo", keys: ["B", "R"], heading: "Relates to" },
];

const menuLabel = (mode: RelationMode, hasParent: boolean) =>
  mode === "parent" ? (hasParent ? "Change or remove parent" : "Add parent") : mode === "blockedBy" ? "Mark as blocked by" : mode === "blocking" ? "Mark as blocking" : "Add relates to";

type RelState = Relations & { loading: boolean; failed: boolean };
const EMPTY: RelState = { blockedBy: [], blocking: [], relatesTo: [], cached: false, loading: true, failed: false };

/** The issue's "Blocked by", "Blocking" and "Relates to" lists, with `reload` after an edit. */
export function useRelations(number: number) {
  const [state, setState] = useState<RelState>(EMPTY);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, failed: false }));
    fetch(`/api/issues/${number}/relationships`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = (await r.json()) as Relations;
        setState({ ...EMPTY, ...body, loading: false, failed: false });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setState((s) => ({ ...s, loading: false, failed: true }));
      });
    return () => ctrl.abort();
  }, [number, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  /** Show an edit before GitHub confirms it; `reload` brings GitHub's lists back. */
  const preview = useCallback((field: ListMode, d: Delta, add: RelatedIssue[]) => {
    setState((s) => ({ ...s, [field]: [...s[field].filter((x) => !d.removed.includes(x.nodeId)), ...add.filter((a) => !s[field].some((x) => x.nodeId === a.nodeId))] }));
  }, []);
  return { ...state, reload, preview };
}

export function toRelated(i: ClientIssue): RelatedIssue {
  return { nodeId: i.nodeId, number: i.number, title: i.title, state: i.state === "closed" ? "closed" : "open", stateReason: i.stateReason, url: i.url, repo: "" };
}

function StateIcon({ state }: { state: string }) {
  return <Icon name={state === "closed" ? "circleCheck" : "circleDot"} size={14} className={state === "closed" ? "text-faint" : "text-brand-text"} />;
}

/** A searchable list of the cached issues, for linking one. */
function IssueSearch({ exclude, onPick, extra = [] }: { exclude: ReadonlySet<string>; onPick: (nodeId: string) => void; extra?: PickItem[] }) {
  const { data } = useAppData();
  const [q, setQ] = useState("");
  const items = useMemo<PickItem[]>(
    () => [
      ...(q ? [] : extra),
      ...searchIssues(data.issues, q, exclude).map((i) => ({ id: i.nodeId, label: `#${i.number} ${i.title}`, icon: <StateIcon state={i.state} /> })),
    ],
    [data.issues, q, exclude, extra],
  );
  return <PickList items={items} onSearch={setQ} onPick={onPick} placeholder="Search by title or #number…" emptyText="No matching issue in Deska" />;
}

/** A button that opens the issue search (the sub-issues list's "Add sub-issue"). */
export function IssuePicker({ label, exclude, onPick, children }: { label: string; exclude: ReadonlySet<string>; onPick: (nodeId: string) => void; children: ReactNode }) {
  const { disabledReason } = useIssueEdits();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabledReason ? true : undefined}
        title={disabledReason ?? label}
        onClick={() => !disabledReason && setOpen(true)}
        className={`flex h-6 items-center gap-1 rounded-md px-1.5 text-[12.5px] text-muted ${disabledReason ? "cursor-default" : "hover:bg-hover hover:text-fg"}`}
      >
        {children}
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={340}>
        <IssueSearch
          exclude={exclude}
          onPick={(id) => {
            setOpen(false);
            onPick(id);
          }}
        />
      </Popover>
    </>
  );
}

/** One linked issue, as a GitHub sidebar row: state, title, `#number`, ✕ to unlink (issues Deska has). */
function RelatedRow({ item, onRemove, removeLabel, extra }: { item: RelatedIssue; onRemove?: () => void; removeLabel: string; extra?: ReactNode }) {
  const open = useOpenIssue();
  const { data } = useAppData();
  const { disabledReason } = useIssueEdits();
  const external = !!item.repo && item.repo.toLowerCase() !== data.meta.repo.toLowerCase();
  const body = (
    <>
      <span className="mt-0.5 shrink-0">
        <StateIcon state={item.state} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-medium ${item.state === "closed" ? "text-muted" : ""}`}>{item.title}</span>
        <span className="block font-mono text-[11.5px] tabular-nums text-faint">{external ? `${item.repo}#${item.number}` : `#${item.number}`}</span>
      </span>
    </>
  );
  return (
    <li className="group flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-hover" data-related={item.number}>
      {external ? (
        <a href={item.url} target="_blank" rel="noreferrer" title={item.repo} className="flex min-w-0 flex-1 items-start gap-2 text-[13px]">
          {body}
        </a>
      ) : (
        <button type="button" data-tab-issue={item.number} onClick={() => open(item.number)} className="flex min-w-0 flex-1 items-start gap-2 text-left text-[13px]">
          {body}
        </button>
      )}
      {extra}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          aria-disabled={disabledReason ? true : undefined}
          title={disabledReason ?? removeLabel}
          onClick={() => !disabledReason && onRemove()}
          className="mt-0.5 grid size-5 shrink-0 place-items-center rounded text-faint opacity-60 hover:bg-active hover:text-fg group-hover:opacity-100"
        >
          <Icon name="x" size={11} />
        </button>
      ) : null}
    </li>
  );
}

const REMOVE_LABEL: Record<RelationMode, (n: number) => string> = {
  parent: () => "Remove parent",
  blockedBy: (n) => `Remove blocked by #${n}`,
  blocking: (n) => `Remove blocking #${n}`,
  relatesTo: (n) => `Remove relates to #${n}`,
};

/** The Relationships section: what the issue is linked to, and one menu to link more. */
export function Relationships({ issue }: { issue: ClientIssue }) {
  const { data, byNodeId } = useAppData();
  const { edit, isPending, disabledReason } = useIssueEdits();
  const { toast } = useToast();
  const rel = useRelations(issue.number);
  const anchor = useRef<HTMLButtonElement>(null);
  // null: closed; "menu": the four choices; a mode: the issue search for it.
  const [step, setStep] = useState<null | "menu" | RelationMode>(null);
  const parent = issue.parentNodeId ? byNodeId.get(issue.parentNodeId) : undefined;
  const hasParent = !!issue.parentNodeId;

  // The ⌥⇧P / B B / B X / B R shortcuts go straight to the search.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ mode: RelationMode; number: number | null }>).detail;
      if (d.number != null && d.number !== issue.number) return;
      if (disabledReason) {
        toast({ message: disabledReason });
        return;
      }
      anchor.current?.scrollIntoView({ block: "nearest" });
      setStep(d.mode);
    };
    window.addEventListener(RELATION_EVENT, on);
    return () => window.removeEventListener(RELATION_EVENT, on);
  }, [issue.number, disabledReason, toast]);

  const exclude = useMemo(() => {
    if (step === "parent") {
      // The issue itself and everything below it would make a loop.
      const s = selfAndDescendants(data.issues, issue.nodeId);
      if (issue.parentNodeId) s.add(issue.parentNodeId);
      return s;
    }
    const list = step && step !== "menu" ? rel[step] : [];
    return new Set([issue.nodeId, ...list.map((x) => x.nodeId)]);
  }, [step, data.issues, issue.nodeId, issue.parentNodeId, rel]);

  const change = async (mode: ListMode, d: Delta) => {
    const added = d.added.flatMap((id) => {
      const i = byNodeId.get(id);
      return i ? [toRelated(i)] : [];
    });
    rel.preview(mode, d, added);
    const out = await edit(issue, mode, d);
    // Done or failed, GitHub's lists are the truth from here.
    if (out !== "pending") rel.reload();
  };
  const pick = (mode: RelationMode, id: string) => {
    setStep(null);
    if (mode === "parent") void edit(issue, "parent", id === REMOVE ? null : id);
    else void change(mode, { added: [id], removed: [] });
  };

  const groups = RELATION_MENU.flatMap(({ mode, heading }): { mode: RelationMode; heading: string; rows: ReactNode }[] => {
    if (mode === "parent") {
      if (!hasParent) return [];
      const row = parent ? (
        <RelatedRow
          item={toRelated(parent)}
          removeLabel={REMOVE_LABEL.parent(0)}
          onRemove={() => void edit(issue, "parent", null)}
          extra={
            progressText(subProgress(parent)) ? (
              <span className="mt-0.5 shrink-0 rounded-full border border-line px-1.5 text-[11.5px] tabular-nums text-muted" title={PROGRESS_TOOLTIP}>
                {progressText(subProgress(parent))}
              </span>
            ) : null
          }
        />
      ) : (
        <li className="px-1.5 py-1 text-[12.5px] text-muted">{issue.parentNumber ? `#${issue.parentNumber}` : "An issue outside Deska"}</li>
      );
      return [{ mode, heading, rows: row }];
    }
    const list = rel[mode];
    if (!list.length) return [];
    return [
      {
        mode,
        heading,
        rows: list.map((x) => (
          <RelatedRow key={x.nodeId} item={x} removeLabel={REMOVE_LABEL[mode](x.number)} onRemove={byNodeId.has(x.nodeId) ? () => void change(mode, { added: [], removed: [x.nodeId] }) : undefined} />
        )),
      },
    ];
  });
  const saving = RELATION_MENU.some(({ mode }) => isPending(issue.nodeId, mode));

  return (
    <section aria-label="Relationships" data-relationships className="border-t border-line-soft pb-1 pt-2 sm:col-span-2">
      <div className="flex items-center gap-2">
        <h3 className="text-[12.5px] text-faint">Relationships</h3>
        {saving && <span role="status" aria-label="Saving" className="size-3 animate-spin rounded-full border-2 border-line border-t-brand" />}
        <span className="flex-1" />
        <button
          ref={anchor}
          type="button"
          aria-label="Edit relationships"
          aria-haspopup="menu"
          aria-expanded={step != null}
          aria-disabled={disabledReason ? true : undefined}
          title={disabledReason ?? "Edit relationships"}
          onClick={() => !disabledReason && setStep("menu")}
          className={`grid size-6 place-items-center rounded-md text-faint ${disabledReason ? "cursor-default" : "hover:bg-hover hover:text-fg"}`}
        >
          <Icon name="sliders" size={14} />
        </button>
      </div>
      {groups.length ? (
        <div className="mt-1 space-y-2">
          {groups.map((g) => (
            <div key={g.mode} data-relation={g.mode}>
              <p className="px-1.5 text-[12px] text-muted">{g.heading}</p>
              <ul>{g.rows}</ul>
            </div>
          ))}
        </div>
      ) : rel.loading ? (
        <p className="px-1.5 pt-1 text-[12.5px] text-faint">Loading…</p>
      ) : (
        <p className="px-1.5 pt-1 text-[12.5px] text-faint">None yet</p>
      )}
      {rel.failed ? <p className="px-1.5 pt-1 text-[12.5px] text-muted">Couldn&apos;t load blocked by, blocking and relates to from GitHub.</p> : null}
      <Popover anchor={anchor} open={step != null} onClose={() => setStep(null)} width={step === "menu" ? 280 : 340}>
        {step === "menu" ? (
          <PickList
            items={RELATION_MENU.map(({ mode, keys }) => ({
              id: mode,
              label: menuLabel(mode, hasParent),
              hint: (
                <span className="flex gap-0.5">
                  {keys.map((k, i) => (
                    <Kbd key={i}>{k}</Kbd>
                  ))}
                </span>
              ),
            }))}
            onPick={(m) => setStep(m as RelationMode)}
            placeholder="Link this issue…"
          />
        ) : step ? (
          <IssueSearch
            exclude={exclude}
            extra={step === "parent" && hasParent ? [{ id: REMOVE, label: "Remove parent", icon: <Icon name="x" size={12} className="text-faint" /> }] : []}
            onPick={(id) => pick(step, id)}
          />
        ) : null}
      </Popover>
    </section>
  );
}
