"use client";

import Link from "next/link";
import { EDITING_OFF } from "@/lib/client/edit";
import { useEffect, useState, type ReactNode } from "react";
import { formatDate, longAgo, plainName } from "@/lib/client/format";
import type { ClientIssue, IssueDetail } from "@/lib/client/types";
import { MISSING_FIELD } from "@/lib/sync/field-map";
import { useAppData } from "../app/provider";
import { useOpenIssue } from "../app/open-issue";
import { useCells } from "../explorer/cells";
import { Icon } from "../icons";
import { Avatar, EmptyHint, OptionDot } from "../props";
import { LinkedPrs } from "../prs/issue-prs";
import { LinkedTasks } from "../tasks/issue-tasks";
import { btn } from "../ui/popover";
import { useIssueEdits } from "./edits";
import { SeenOnOpen, WatchStar } from "../watch/star";
import { PossibleDuplicates } from "./duplicates";
import { FieldPicker } from "./field-picker";

// Client cache so flipping between issues with j/k is instant on revisit.
const detailCache = new Map<number, { at: number; detail: IssueDetail }>();
const FRESH_MS = 60_000;

export function useIssueDetail(number: number | null) {
  const [state, setState] = useState<{ detail: IssueDetail | null; error: string | null; loading: boolean }>({ detail: null, error: null, loading: false });
  useEffect(() => {
    if (number == null) return;
    const hit = detailCache.get(number);
    setState({ detail: hit?.detail ?? null, error: null, loading: !hit });
    if (hit && Date.now() - hit.at < FRESH_MS) return;
    const ctrl = new AbortController();
    fetch(`/api/issues/${number}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        detailCache.set(number, { at: Date.now(), detail: body });
        setState({ detail: body, error: null, loading: false });
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setState((s) => ({ ...s, error: String(e?.message ?? e), loading: false }));
      });
    return () => ctrl.abort();
  }, [number]);
  return state;
}

function Prop({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-8 items-center gap-2 ${className}`}>
      <dt className="w-[5.5rem] shrink-0 text-[12.5px] text-faint">{label}</dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[13px]">{children}</dd>
    </div>
  );
}

function Skeleton() {
  return (
    <div role="status" className="animate-pulse space-y-2.5" aria-label="Loading">
      {[92, 78, 85, 60].map((w) => (
        <div key={w} className="h-3 rounded bg-active" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/** In place of a deleted field's values (§4.1): say so and link to the mapping. */
function MissingField() {
  return (
    <Link href="/settings#mapping" data-missing-field className="text-[12.5px] font-medium text-warning hover:underline">
      {MISSING_FIELD}
    </Link>
  );
}

function Properties({ issue }: { issue: ClientIssue }) {
  const { option, data } = useAppData();
  const { meta } = data;
  const c = useCells();
  const none = <span className="text-faint">—</span>;
  return (
    <dl className="grid gap-x-6 sm:grid-cols-2">
      <Prop label="Status">
        {meta.mapping.status?.missing ? (
          <MissingField />
        ) : (
          <FieldPicker issue={issue} field="status" label="Status">
            {c.status(issue)}
            {issue.state === "closed" ? `Closed${issue.stateReason === "not_planned" ? " · not planned" : ""}` : (issue.statusName ?? none)}
          </FieldPicker>
        )}
      </Prop>
      <Prop label="Priority">
        {meta.mapping.priority?.missing ? (
          <MissingField />
        ) : (
          <FieldPicker issue={issue} field="priority" label="Priority">
            {c.priority(issue)}
            {issue.priorityName ?? none}
          </FieldPicker>
        )}
      </Prop>
      <Prop label="Assignees">
        <FieldPicker issue={issue} field="assignees" label="Assignees">
          {issue.assignees.length ? (
            <>
              {c.assignee(issue)}
              <span className="truncate">{issue.assignees.join(", ")}</span>
            </>
          ) : (
            none
          )}
        </FieldPicker>
      </Prop>
      {meta.mapping.sprint && (
        <Prop label="Release">
          {meta.mapping.sprint.missing ? (
            <MissingField />
          ) : (
            <FieldPicker issue={issue} field="release" label="Release">
              {c.release(issue) ?? none}
            </FieldPicker>
          )}
        </Prop>
      )}
      {meta.dimensions.map((d) => {
        const v = issue.dims[d.id];
        return (
          <Prop key={d.id} label={d.name}>
            {d.missing ? (
              <MissingField />
            ) : (
              <FieldPicker issue={issue} field={d.key} label={d.name}>
                {v ? (
                  <>
                    <OptionDot color={option(d.key, v.id)?.color} />
                    {plainName(v.name ?? "Missing option") || v.name}
                  </>
                ) : (
                  none
                )}
              </FieldPicker>
            )}
          </Prop>
        );
      })}
      <Prop label="Type">
        <FieldPicker issue={issue} field="type" label="Type">
          {c.type(issue) ?? none}
        </FieldPicker>
      </Prop>
      <Prop label="Milestone">
        <FieldPicker issue={issue} field="milestone" label="Milestone">
          {issue.milestoneName ?? none}
        </FieldPicker>
      </Prop>
      <Prop label="Labels" className="sm:col-span-2">
        <FieldPicker issue={issue} field="labels" label="Labels">
          {c.labels(issue, 30) ?? none}
        </FieldPicker>
      </Prop>
    </dl>
  );
}

/** "Assign to me" and Close / Reopen (W2). */
function IssueActions({ issue }: { issue: ClientIssue }) {
  const { data, viewer } = useAppData();
  const { edit, isPending, disabledReason } = useIssueEdits();
  const mine = issue.assignees.some((a) => a.toLowerCase() === viewer.toLowerCase());
  const closeBlocked = issue.state === "open" ? (data.meta.closeBlocked ?? null) : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line-soft pb-0.5 pt-2">
      {!mine && (
        <button
          type="button"
          aria-disabled={disabledReason ? true : undefined}
          title={disabledReason ?? "Add yourself as an assignee"}
          onClick={() => !disabledReason && void edit(issue, "assignees", { added: [viewer], removed: [] })}
          className={btn.ghost}
        >
          <Icon name="user" size={13} /> Assign to me
        </button>
      )}
      <span className="flex-1" />
      <button
        type="button"
        aria-disabled={disabledReason || closeBlocked ? true : undefined}
        title={disabledReason ?? closeBlocked ?? (issue.state === "open" ? "Close the issue (Status moves to the done option)" : "Reopen the issue")}
        onClick={() => !disabledReason && !closeBlocked && void edit(issue, "state", issue.state === "open" ? "closed" : "open")}
        className={btn.outline}
      >
        {isPending(issue.nodeId, "state") && <span role="status" aria-label="Saving" className="size-3 animate-spin rounded-full border-2 border-line border-t-brand" />}
        <Icon name={issue.state === "open" ? "circleCheck" : "circleDot"} size={13} />
        {issue.state === "open" ? "Close issue" : "Reopen issue"}
      </button>
    </div>
  );
}

function SubIssues({ issue }: { issue: ClientIssue }) {
  const { data } = useAppData();
  const open = useOpenIssue();
  const c = useCells();
  const subs = data.issues
    .filter((i) => i.parentNodeId === issue.nodeId)
    .sort((a, b) => (a.state === b.state ? (b.priorityRank ?? -1) - (a.priorityRank ?? -1) : a.state === "open" ? -1 : 1));
  if (!subs.length) return null;
  const pct = Math.round((issue.subClosed / Math.max(1, issue.subTotal)) * 100);
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-muted">
        Sub-issues
        <span className="font-normal tabular-nums text-faint">
          {issue.subClosed}/{issue.subTotal}
        </span>
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-active">
          <span className="block h-full rounded-full bg-brand-border" style={{ width: `${pct}%` }} />
        </span>
      </h3>
      <ul className="overflow-hidden rounded-lg border border-line">
        {subs.map((s) => (
          <li key={s.nodeId}>
            <button type="button" onClick={() => open(s.number)} className="flex h-9 w-full items-center gap-2.5 border-b border-line-soft px-3 text-left last:border-b-0 hover:bg-hover">
              {c.priority(s)}
              {c.status(s)}
              <span className="w-14 shrink-0">{c.id(s)}</span>
              <span className={`min-w-0 flex-1 truncate ${s.state === "closed" ? "text-muted line-through decoration-faint" : ""}`}>{s.title}</span>
              {c.assignee(s)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Comment({ author, avatarUrl, createdAt, html, text, url }: { author: string; avatarUrl: string | null; createdAt: string; html: string | null; text: string; url: string | null }) {
  const when = <span className="text-faint" title={new Date(createdAt).toLocaleString()}>{longAgo(createdAt)}</span>;
  return (
    <li className="flex gap-3">
      <Avatar login={author} url={avatarUrl} size={26} />
      <div className="min-w-0 flex-1 rounded-xl border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2 text-[12.5px]">
          <span className="font-semibold">{author}</span>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="text-faint hover:text-muted" title={new Date(createdAt).toLocaleString()}>
              {longAgo(createdAt)}
            </a>
          ) : when}
        </div>
        {html ? (
          <div className="gh-markdown px-3 py-2.5" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="whitespace-pre-wrap px-3 py-2.5 text-[14px]">{text}</p>
        )}
      </div>
    </li>
  );
}

export function IssueDetailView({ number, mode, onClose }: { number: number; mode: "peek" | "page"; onClose?: () => void }) {
  const { data, byNumber, byNodeId, avatarOf } = useAppData();
  const demo = data.meta.demo;
  const openIssue = useOpenIssue();
  const issue = byNumber.get(number);
  const { detail, error, loading } = useIssueDetail(issue ? number : null);
  const [copied, setCopied] = useState(false);

  if (!issue) {
    return (
      <div className="flex h-full flex-col">
        {onClose && (
          <div className="flex h-12 items-center justify-end border-b border-line px-3">
            <button type="button" onClick={onClose} aria-label="Close" className={btn.icon}>
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <EmptyHint icon="search" title={`Issue #${number} is not in the Deska cache`} hint="It may be a pull request, or closed for longer than the import window." />
      </div>
    );
  }

  const parent = issue.parentNodeId ? byNodeId.get(issue.parentNodeId) : undefined;
  const copy = () => {
    void navigator.clipboard?.writeText(demo ? window.location.href : issue.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-3">
        {parent ? (
          <button type="button" onClick={() => openIssue(parent.number)} className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px] text-muted hover:bg-hover hover:text-fg" title="Open epic">
            <Icon name="epic" size={13} className="shrink-0 text-violet" />
            <span className="truncate">{parent.title.replace(/^Epic:\s*/i, "")}</span>
            <Icon name="chevronRight" size={12} className="shrink-0 text-faint" />
          </button>
        ) : null}
        <span className="font-mono text-[12px] text-faint">#{issue.number}</span>
        <span className="flex-1" />
        <WatchStar kind="issue" id={issue.nodeId} />
        <SeenOnOpen kind="issue" id={issue.nodeId} />
        <button type="button" onClick={copy} title={demo ? "Copy link to this page" : "Copy GitHub link"} className={btn.icon}>
          <Icon name={copied ? "check" : "link"} size={15} />
        </button>
        {mode === "peek" && (
          <Link href={`/issues/${issue.number}`} title="Open full page" className={btn.icon}>
            <Icon name="external" size={15} className="rotate-0" />
          </Link>
        )}
        {demo ? null : (
          <a href={issue.url} target="_blank" rel="noreferrer" className={btn.outline} title="Open in GitHub (O)">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </a>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close panel" title="Close (Esc)" className={btn.icon}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`space-y-6 px-5 py-5 ${mode === "page" ? "mx-auto max-w-3xl md:px-8" : ""}`}>
          <header>
            <h2 className="text-[20px] font-semibold leading-snug tracking-tight">{issue.title}</h2>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-faint">
              <Avatar login={issue.authorLogin} url={avatarOf(issue.authorLogin)} size={16} />
              <span className="text-muted">{issue.authorLogin}</span> opened {formatDate(issue.createdAt)} · updated {longAgo(issue.updatedAt)}
              {issue.closedAt && <> · closed {formatDate(issue.closedAt)}</>}
            </p>
          </header>

          <div className="rounded-xl border border-line bg-bg/40 px-3 py-1.5">
            <Properties issue={issue} />
            <IssueActions issue={issue} />
            {demo ? (
              <p className="flex items-center gap-1.5 pb-0.5 pt-1 text-[11.5px] text-faint">
                <Icon name="lock" size={11} /> Sample issue. The title, description, and assignees are generated for preview.
              </p>
            ) : !data.meta.writeMode ? (
              <p className="flex items-center gap-1.5 pb-0.5 pt-1 text-[11.5px] text-faint">
                <Icon name="lock" size={11} /> {data.meta.editOffReason ?? EDITING_OFF}. Change fields on{" "}
                <a href={issue.url} target="_blank" rel="noreferrer" className="underline hover:text-muted">
                  GitHub
                </a>
                ; they sync back within minutes.
              </p>
            ) : null}
          </div>

          <LinkedTasks nodeId={issue.nodeId} number={issue.number} />

          <LinkedPrs nodeId={issue.nodeId} />
          <PossibleDuplicates number={issue.number} />

          <SubIssues issue={issue} />

          <section>
            <h3 className="mb-2 text-[12.5px] font-semibold text-muted">Description</h3>
            {loading && !detail ? (
              <Skeleton />
            ) : detail?.bodyHtml ? (
              <div className="gh-markdown" dangerouslySetInnerHTML={{ __html: detail.bodyHtml }} />
            ) : detail?.body ? (
              <p className="whitespace-pre-wrap text-[14px]">{detail.body}</p>
            ) : error ? (
              <p className="text-critical">Could not load the description: {error}</p>
            ) : (
              <p className="text-faint">No description.</p>
            )}
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-[12.5px] font-semibold text-muted">
              Activity
              {detail && <span className="font-normal text-faint">{detail.comments.length} comment{detail.comments.length === 1 ? "" : "s"}</span>}
            </h3>
            {detail?.commentsError && (
              <p className="mb-3 rounded-lg bg-banner-warning px-3 py-2 text-[12.5px] text-warning">{detail.commentsError}</p>
            )}
            {loading && !detail ? (
              <Skeleton />
            ) : (
              <ol className="space-y-3">
                {(detail?.comments ?? []).map((cm) => (
                  <Comment key={cm.id} author={cm.author} avatarUrl={cm.avatarUrl ?? avatarOf(cm.author)} createdAt={cm.createdAt} html={cm.bodyHtml} text={cm.body} url={demo ? null : cm.url} />
                ))}
              </ol>
            )}
            {demo ? null : (
              <a href={`${issue.url}#new_comment_field`} target="_blank" rel="noreferrer" className={`${btn.outline} mt-4`}>
                <Icon name="message" size={13} /> Reply on GitHub
              </a>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
