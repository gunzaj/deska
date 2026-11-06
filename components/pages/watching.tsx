"use client";

// The Watching page (IMPROVEMENTS F6): the issues and saved views you follow,
// each with what changed since you last looked. Opening an item clears it.
import Link from "next/link";
import { useMemo } from "react";
import { describeFieldChange } from "@/lib/client/watch";
import { longAgo } from "@/lib/client/format";
import type { FieldChange } from "@/lib/sync/changes";
import { useOpenIssue } from "../app/open-issue";
import { useAppData, useAppViews } from "../app/provider";
import { Page } from "../app/shell";
import { Icon } from "../icons";
import { EmptyHint } from "../props";
import { btn } from "../ui/popover";
import { useWatchlist, watchKey, type WatchItem } from "../watch/store";

function ChangeList({ changes }: { changes: FieldChange[] }) {
  const { data, byNodeId } = useAppData();
  const openIssue = useOpenIssue();
  const { markSeen } = useWatchlist();
  return (
    <ul className="divide-y divide-line-soft border-t border-line-soft">
      {changes.map((c, n) => {
        const issue = byNodeId.get(c.issueNodeId);
        const line = describeFieldChange(data.meta, c);
        return (
          <li key={`${c.issueNodeId}:${c.field}:${c.observedAt}:${n}`} className="flex flex-wrap items-baseline gap-x-2 px-4 py-1.5 text-[12.5px]" data-change={c.field}>
            {issue ? (
              <button
                type="button"
                className="min-w-0 max-w-[24rem] truncate text-left hover:underline"
                onClick={() => {
                  openIssue(issue.number);
                  void markSeen("issue", c.issueNodeId);
                }}
              >
                <span className="text-faint">#{issue.number}</span> {issue.title}
              </button>
            ) : (
              <span className="text-faint">an issue not in the cache</span>
            )}
            <span className="text-muted">
              <span className="text-faint">{line.label}:</span> {line.text}
            </span>
            <span className="ml-auto text-[11.5px] text-faint">
              {c.source === "deska" ? "by you in Deska · " : ""}
              {longAgo(c.observedAt)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Row({ w }: { w: WatchItem }) {
  const { byNodeId } = useAppData();
  const { views } = useAppViews();
  const { changes, toggle, markSeen } = useWatchlist();
  const openIssue = useOpenIssue();
  const list = changes[watchKey(w.kind, w.targetId)] ?? [];
  const issue = w.kind === "issue" ? byNodeId.get(w.targetId) : undefined;
  const view = w.kind === "view" ? views.find((v) => v.id === w.targetId) : undefined;
  return (
    <li className="overflow-hidden rounded-xl border border-line bg-surface shadow-raised" data-watch={watchKey(w.kind, w.targetId)}>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <Icon name={w.kind === "view" ? "eye" : "circleDot"} size={14} className="text-faint" />
        {w.kind === "issue" ? (
          issue ? (
            <button type="button" className="min-w-0 flex-1 truncate text-left text-[13.5px] font-medium hover:underline" onClick={() => { openIssue(issue.number); void markSeen("issue", w.targetId); }}>
              <span className="text-faint">#{issue.number}</span> {issue.title}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted">An issue that isn&apos;t in the cache any more</span>
          )
        ) : view ? (
          <Link href={`/views/${view.id}`} className="min-w-0 flex-1 truncate text-[13.5px] font-medium hover:underline">
            {view.name} <span className="font-normal text-faint">view</span>
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted">A view that doesn&apos;t exist any more</span>
        )}
        <span className={`rounded-full px-2 text-[11.5px] tabular-nums ${list.length ? "bg-brand-soft text-brand-text" : "text-faint"}`} data-change-count>
          {list.length ? `${list.length} change${list.length === 1 ? "" : "s"}` : "no changes"}
        </span>
        {list.length > 0 && (
          <button type="button" className={btn.ghost} onClick={() => void markSeen(w.kind, w.targetId)}>
            Mark as seen
          </button>
        )}
        <button type="button" className={btn.ghost} onClick={() => void toggle(w.kind, w.targetId)} aria-label="Stop watching">
          Stop watching
        </button>
      </div>
      {list.length > 0 && <ChangeList changes={list} />}
    </li>
  );
}

export function WatchingPage() {
  const { watches, changes, loaded } = useWatchlist();
  const sorted = useMemo(
    () => [...watches].sort((a, b) => (changes[watchKey(b.kind, b.targetId)]?.length ?? 0) - (changes[watchKey(a.kind, a.targetId)]?.length ?? 0) || a.targetId.localeCompare(b.targetId)),
    [watches, changes],
  );
  return (
    <Page title="Watching" icon={<Icon name="star" size={15} />}>
      <div className="mx-auto max-w-3xl space-y-3 p-4 md:p-6">
        {!loaded ? (
          <p className="text-muted">Loading…</p>
        ) : sorted.length === 0 ? (
          <EmptyHint icon="star" title="Nothing watched yet" hint="Star an issue or a saved view to see here what changes on it: Status, Priority, Team, Platform, Release, state, labels and assignees." />
        ) : (
          <>
            <p className="text-[12px] text-faint">What changed since you last opened each one. Opening it clears its changes.</p>
            <ul className="space-y-3">
              {sorted.map((w) => (
                <Row key={watchKey(w.kind, w.targetId)} w={w} />
              ))}
            </ul>
          </>
        )}
      </div>
    </Page>
  );
}
