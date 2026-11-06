"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { usePanelFocus } from "../app/panel-focus";
import { formatDate, longAgo } from "@/lib/client/format";
import { CHECKS_LABEL, checksKey } from "@/lib/client/prs";
import type { IssueDetail } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { useOpenIssue } from "../app/open-issue";
import { useCells } from "../explorer/cells";
import { Icon } from "../icons";
import { Avatar, EmptyHint } from "../props";
import { LinkedTasks } from "../tasks/issue-tasks";
import { btn } from "../ui/popover";
import { ChecksIcon, DecisionBadge, PrStateIcon, REVIEW_STATE_LABEL, reviewerStates } from "./bits";
import { closePr, PR_PARAM } from "./open-pr";
import { usePrs } from "./store";

/** Read-only PR side panel for `?pr=N` (SPEC §13.3). */
export function PrPeek() {
  const params = useSearchParams();
  const n = Number(params.get(PR_PARAM));
  const open = Number.isInteger(n) && n > 0;
  const panel = useRef<HTMLElement>(null);
  const shown = useRef(n);
  shown.current = n;
  usePanelFocus(panel, open, () => `[data-pr="${shown.current}"]`);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (document.querySelector('[role="dialog"]')) return;
      closePr();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <aside ref={panel} role="complementary" data-side-panel aria-label={`Pull request #${n}`} className="anim-slide fixed inset-0 z-30 flex flex-col bg-surface md:inset-y-3 md:left-auto md:right-3 md:w-[min(46rem,calc(100vw-260px))] md:rounded-xl md:border md:border-line md:shadow-modal">
      <PrDetail key={n} number={n} />
    </aside>
  );
}

const REVIEW_ICON: Record<string, string> = { APPROVED: "#1f883d", CHANGES_REQUESTED: "var(--prio-1)", COMMENTED: "var(--fg-faint)", REQUESTED: "var(--prio-2)" };

function PrDetail({ number }: { number: number }) {
  const { byNumber, loaded, error: loadError, retry } = usePrs();
  const { byNodeId, avatarOf, data } = useAppData();
  const cells = useCells();
  const openIssue = useOpenIssue();
  const pr = byNumber.get(number);
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/pulls/${number}`, { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setDetail(body);
      })
      .catch((e) => !ctrl.signal.aborted && setError(String(e?.message ?? e)));
    return () => ctrl.abort();
  }, [number]);

  const header = (
    <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line px-3">
      {pr && <PrStateIcon pr={pr} />}
      <span className="font-mono text-[12px] text-faint">#{number}</span>
      <span className="flex-1" />
      {pr && !data.meta.demo && (
        <a href={pr.url} target="_blank" rel="noreferrer" className={btn.outline} title="Open in GitHub">
          <Icon name="external" size={13} /> GitHub
        </a>
      )}
      <button type="button" onClick={closePr} aria-label="Close panel" title="Close (Esc)" className={btn.icon}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );

  if (!pr) {
    return (
      <>
        {header}
        {loaded ? (
          <EmptyHint icon="git" title={`PR #${number} is not in the Deska cache`} hint="It may be older than the import window, or not in this repository." />
        ) : loadError ? (
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
        ) : (
          <p className="p-6 text-muted">Loading…</p>
        )}
      </>
    );
  }

  const reviewers = reviewerStates(pr);
  const linked = pr.closingIssues.map((id) => byNodeId.get(id)).filter((i): i is NonNullable<typeof i> => i != null);
  const checks = checksKey(pr.checksState);

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <header>
          <h2 className="text-[20px] font-semibold leading-snug tracking-tight">{pr.title}</h2>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-faint">
            <Avatar login={pr.author} url={avatarOf(pr.author)} size={16} />
            <span className="text-muted">{pr.author}</span>
            wants to merge <code className="rounded bg-hover px-1 text-[11.5px] text-muted">{pr.headRef}</code> into <code className="rounded bg-hover px-1 text-[11.5px] text-muted">{pr.baseRef}</code>
            · opened {formatDate(pr.createdAt)} · updated {longAgo(pr.updatedAt)}
            {pr.mergedAt && <> · merged {formatDate(pr.mergedAt)}</>}
          </p>
        </header>

        <div className="space-y-3 rounded-xl border border-line bg-bg/40 px-3 py-2.5 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 text-[12.5px] text-faint">Review</span>
            {pr.reviewDecision ? <DecisionBadge decision={pr.reviewDecision} /> : <span className="text-faint">No decision</span>}
          </div>
          <div className="flex items-start gap-2">
            <span className="w-24 shrink-0 pt-0.5 text-[12.5px] text-faint">Reviewers</span>
            <ul className="min-w-0 flex-1 space-y-1">
              {reviewers.length === 0 && <li className="text-faint">None requested</li>}
              {reviewers.map((r) => (
                <li key={`${r.team}-${r.who}`} className="flex items-center gap-2">
                  {r.team ? <Icon name="users" size={14} className="text-faint" /> : <Avatar login={r.who} url={avatarOf(r.who)} size={16} />}
                  <span>{r.team ? `@${r.who}` : r.who}</span>
                  <span className="text-[12px]" style={{ color: REVIEW_ICON[r.state] ?? "var(--fg-faint)" }}>
                    {REVIEW_STATE_LABEL[r.state] ?? r.state}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[12.5px] text-faint">Checks</span>
            <ChecksIcon state={pr.checksState} />
            <span>{CHECKS_LABEL[checks]}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-[12.5px] text-faint">Changes</span>
            <span className="tabular-nums">
              <span className="text-[#1f883d]">+{pr.additions}</span> <span className="text-critical">−{pr.deletions}</span>
            </span>
          </div>
          <p className="flex items-center gap-1.5 border-t border-line-soft pt-2 text-[11.5px] text-faint">
            <Icon name="lock" size={11} /> {data.meta.demo ? "Sample pull request. The title and reviewers are generated for preview." : "Read-only in Deska. Review on GitHub."}
          </p>
        </div>

        <section aria-label="Linked issues">
          <h3 className="mb-2 text-[12.5px] font-semibold text-muted">Closes</h3>
          {linked.length === 0 ? (
            <p className="text-[12.5px] text-faint">No linked issues.</p>
          ) : (
            <ul className="divide-y divide-line-soft rounded-xl border border-line">
              {linked.map((i) => (
                <li key={i.nodeId}>
                  <button type="button" onClick={() => openIssue(i.number)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-hover">
                    {cells.status(i)}
                    <span className="font-mono text-[12px] text-faint">#{i.number}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{i.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <LinkedTasks nodeId={pr.nodeId} number={pr.number} />

        <section>
          <h3 className="mb-2 text-[12.5px] font-semibold text-muted">Description</h3>
          {detail?.bodyHtml ? <div className="gh-markdown" dangerouslySetInnerHTML={{ __html: detail.bodyHtml }} /> : detail?.body ? <p className="whitespace-pre-wrap text-[14px]">{detail.body}</p> : error ? <p className="text-critical">Could not load the description: {error}</p> : detail ? <p className="text-faint">No description.</p> : <p className="text-faint">Loading…</p>}
        </section>

        <section>
          <h3 className="mb-3 text-[12.5px] font-semibold text-muted">Conversation {detail && <span className="font-normal text-faint">{detail.comments.length}</span>}</h3>
          <ol className="space-y-3">
            {(detail?.comments ?? []).map((c) => (
              <li key={c.id} className="flex gap-2.5">
                <Avatar login={c.author} url={c.avatarUrl ?? avatarOf(c.author)} size={22} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-faint">
                    <span className="font-medium text-muted">{c.author}</span> {longAgo(c.createdAt)}
                  </p>
                  {c.bodyHtml ? <div className="gh-markdown text-[13.5px]" dangerouslySetInnerHTML={{ __html: c.bodyHtml }} /> : <p className="whitespace-pre-wrap text-[13.5px]">{c.body}</p>}
                </div>
              </li>
            ))}
          </ol>
          {data.meta.demo ? null : (
            <a href={pr.url} target="_blank" rel="noreferrer" className={`${btn.outline} mt-4`}>
              <Icon name="message" size={13} /> Reply on GitHub
            </a>
          )}
        </section>
      </div>
    </>
  );
}
