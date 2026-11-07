"use client";

// Parent progress and the live children list in the issue panel (§4.4).
// Progress is GitHub's own count; the list is fetched live and paged, so
// children outside the cache and in other repositories show too.
import { useCallback, useEffect, useRef, useState } from "react";
import { PROGRESS_TOOLTIP, progressText, subProgress } from "@/lib/client/progress";
import type { ClientIssue } from "@/lib/client/types";
import type { SubIssueItem } from "@/lib/server/sub-issues";
import { useAppData } from "../app/provider";
import { useOpenIssue } from "../app/open-issue";
import { Icon } from "../icons";
import { StatusIcon } from "../props";

type Page = { items: SubIssueItem[]; total: number; nextCursor: string | null };
type Load = { items: SubIssueItem[]; total: number | null; cursor: string | null; done: boolean; loading: boolean; failed: boolean };
const EMPTY: Load = { items: [], total: null, cursor: null, done: false, loading: true, failed: false };

/** Pages through `/sub-issues` until the end or the first failure; `retry` continues where it stopped. */
function useSubIssues(number: number) {
  const [state, setState] = useState<Load>(EMPTY);
  const ref = useRef<Load>(EMPTY);
  const run = useCallback(
    async (from: Load, signal: AbortSignal) => {
      let cur: Load = { ...from, loading: true, failed: false };
      setState(cur);
      ref.current = cur;
      while (!cur.done) {
        const url = `/api/issues/${number}/sub-issues${cur.cursor ? `?after=${encodeURIComponent(cur.cursor)}` : ""}`;
        const page = await fetch(url, { signal, cache: "no-store" })
          .then(async (r) => (r.ok ? ((await r.json()) as Page) : null))
          .catch(() => null);
        if (signal.aborted) return;
        if (!page) {
          cur = { ...cur, loading: false, failed: true };
          break;
        }
        cur = { items: [...cur.items, ...page.items], total: page.total, cursor: page.nextCursor, done: page.nextCursor == null, loading: !!page.nextCursor, failed: false };
        setState(cur);
        ref.current = cur;
      }
      setState({ ...cur, loading: false });
      ref.current = { ...cur, loading: false };
    },
    [number],
  );
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    void run(EMPTY, c.signal);
    return () => c.abort();
  }, [run]);
  const retry = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    void run(ref.current, c.signal);
  }, [run]);
  return { ...state, retry };
}

export function SubIssues({ issue }: { issue: ClientIssue }) {
  const open = useOpenIssue();
  const { option, data } = useAppData();
  const p = subProgress(issue);
  const live = useSubIssues(issue.number);
  if (p.kind === "none" && !live.items.length) return null;
  const nStatus = data.meta.fields.status.length;
  const total = live.total ?? (p.kind === "counted" ? p.total : null);
  const partial = !live.loading && (live.failed || (total != null && live.items.length < total));
  const sorted = [...live.items].sort((a, b) => (a.state === b.state ? a.number - b.number : a.state === "open" ? -1 : 1));
  return (
    <section aria-label="Sub-issues" data-sub-issues>
      <h3 className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-muted">
        Sub-issues
        <span className="font-normal tabular-nums text-faint" title={p.kind === "counted" ? PROGRESS_TOOLTIP : undefined} data-sub-progress={p.kind}>
          {progressText(p)}
        </span>
        {p.kind === "counted" ? (
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-active" title={PROGRESS_TOOLTIP}>
            <span className="block h-full rounded-full bg-brand-border" style={{ width: `${p.pct}%` }} />
          </span>
        ) : null}
      </h3>
      {live.loading && !live.items.length ? (
        <p role="status" className="text-[12.5px] text-faint">Loading sub-issues…</p>
      ) : null}
      {sorted.length ? (
        <ul className="overflow-hidden rounded-lg border border-line">
          {sorted.map((s) => {
            const status = option("status", s.statusOptionId);
            const external = s.repo.toLowerCase() !== data.meta.repo.toLowerCase();
            return (
              <li key={s.nodeId} className="flex h-9 items-center gap-2.5 border-b border-line-soft px-3 last:border-b-0 hover:bg-hover" data-sub-issue={s.number}>
                <span title={s.state === "closed" ? "Closed" : (status?.name ?? "No status")}>
                  <StatusIcon option={status} total={nStatus} state={s.state} stateReason={s.stateReason} />
                </span>
                <span className="w-14 shrink-0 font-mono text-[11.5px] tabular-nums text-faint">#{s.number}</span>
                {external ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className={`min-w-0 flex-1 truncate ${s.state === "closed" ? "text-muted line-through decoration-faint" : ""}`} title={s.repo}>
                    {s.title}
                  </a>
                ) : (
                  <button type="button" onClick={() => open(s.number)} className={`min-w-0 flex-1 truncate text-left ${s.state === "closed" ? "text-muted line-through decoration-faint" : ""}`}>
                    {s.title}
                  </button>
                )}
                {status ? <span className="hidden shrink-0 text-[11.5px] text-faint sm:inline">{status.name}</span> : null}
                <a href={s.url} target="_blank" rel="noreferrer" aria-label={`Open #${s.number} on GitHub`} title="Open on GitHub" className="shrink-0 text-faint hover:text-fg">
                  <Icon name="external" size={13} />
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
      {partial ? (
        <p role="status" className="mt-1.5 flex items-center gap-2 text-[12.5px] text-muted" data-sub-issues-partial>
          Showing {live.items.length} of {total ?? "?"} — couldn&apos;t load the rest
          <button type="button" onClick={live.retry} className="rounded px-1.5 text-brand-text hover:underline">
            Retry
          </button>
        </p>
      ) : null}
    </section>
  );
}
