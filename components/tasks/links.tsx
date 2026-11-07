"use client";

import { useRef, useState } from "react";
import { plainName } from "@/lib/client/format";
import { searchIssues } from "@/lib/client/search";
import type { TaskLink } from "@/lib/tasks/model";
import { useAppData } from "../app/provider";
import { useOpenIssue } from "../app/open-issue";
import { useCells } from "../explorer/cells";
import { Icon } from "../icons";
import { btn, PickList, Popover, type PickItem } from "../ui/popover";

/**
 * Live view of a linked issue (§12.1): number, title, status and state come
 * from the cache, so a close on GitHub shows up as a badge. The task itself is
 * never completed by it.
 */
export function LinkChip({ link, compact = false, onRemove }: { link: TaskLink; compact?: boolean; onRemove?: () => void }) {
  const { byNodeId, byNumber } = useAppData();
  const cells = useCells();
  const openIssue = useOpenIssue();
  const issue = byNodeId.get(link.nodeId) ?? byNumber.get(link.number);
  const closed = issue?.state === "closed";
  const title = issue?.title ?? "Not in the Deska cache";

  if (compact) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openIssue(link.number);
        }}
        title={`#${link.number} ${title}${closed ? " (closed)" : ""}`}
        className="inline-flex h-5 max-w-[16rem] items-center gap-1 rounded-full border border-line px-1.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg"
      >
        {issue ? cells.status(issue) : <Icon name="link" size={11} />}
        <span className="font-mono tabular-nums">#{link.number}</span>
        <span className="truncate">{issue?.title}</span>
        {closed && <span className="shrink-0 rounded bg-violet-soft px-1 text-[10.5px] font-semibold text-violet">Closed</span>}
      </button>
    );
  }

  return (
    <div className="group flex min-h-9 items-center gap-2 rounded-lg border border-line px-2 py-1.5">
      {issue ? cells.status(issue) : <Icon name="link" size={14} className="text-faint" />}
      <button type="button" onClick={() => openIssue(link.number)} className="min-w-0 flex-1 text-left" title="Open in the side panel">
        <span className="font-mono text-[12px] tabular-nums text-faint">#{link.number}</span>{" "}
        <span className={`text-[13px] ${issue ? "" : "text-faint"}`}>{title}</span>
      </button>
      {closed ? (
        <span className="shrink-0 rounded bg-violet-soft px-1.5 py-0.5 text-[11px] font-semibold text-violet">Closed</span>
      ) : issue?.statusName ? (
        <span className="shrink-0 text-[11.5px] text-faint">{plainName(issue.statusName)}</span>
      ) : null}
      {onRemove && (
        <button type="button" onClick={onRemove} className={`${btn.icon} size-6 opacity-60 group-hover:opacity-100`} aria-label={`Unlink #${link.number}`} title="Unlink">
          <Icon name="x" size={13} />
        </button>
      )}
    </div>
  );
}

/** "Link issue" button with a searchable picker over the cache. */
export function AddLinkButton({ linked, onAdd }: { linked: number[]; onAdd: (n: number) => void }) {
  const { data } = useAppData();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const taken = new Set(linked);
  const found = q.trim() ? searchIssues(data.issues, q, 30) : data.issues.filter((i) => i.state === "open").slice(0, 30);
  const items: PickItem[] = found
    .filter((i) => !taken.has(i.number))
    .map((i) => ({ id: String(i.number), label: `#${i.number} ${i.title}`, section: "Issues", icon: <Icon name={i.state === "closed" ? "circleCheck" : "circleDot"} size={13} className="text-faint" /> }));
  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen(true)} className={btn.ghost}>
        <Icon name="link" size={13} /> Link issue
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} width={380}>
        {/* Items come pre-ranked by searchIssues (all words, labels, accents), so PickList mustn't filter them again. */}
        <PickList
          items={items}
          onSearch={setQ}
          onPick={(id) => {
            onAdd(Number(id));
            setOpen(false);
          }}
          placeholder="Search issues by # or title…"
          emptyText="No matching issues"
        />
      </Popover>
    </>
  );
}
