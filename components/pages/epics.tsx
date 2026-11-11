"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { pluralize } from "@/lib/client/format";
import { PROGRESS_TOOLTIP, progressKey, progressText, subProgress } from "@/lib/client/progress";
import type { ClientIssue } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { useOpenIssue } from "../app/open-issue";
import { Page } from "../app/shell";
import { useCells } from "../explorer/cells";
import { Icon } from "../icons";
import { EmptyHint } from "../props";

type Sort = "progress" | "updated" | "size";

function EpicRow({ e, onOpen, peeked }: { e: ClientIssue; onOpen: () => void; peeked: boolean }) {
  const c = useCells();
  const p = subProgress(e);
  const pct = p.kind === "counted" ? p.pct : 0;
  return (
    <button type="button" data-peek-row data-peeked={peeked ? "" : undefined} onClick={onOpen} className="flex h-14 w-full items-center gap-3 border-b border-line-soft px-4 text-left hover:bg-hover">
      {c.status(e)}
      <span className="w-14 shrink-0">{c.id(e)}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13.5px] font-medium ${e.state === "closed" ? "text-muted" : ""}`}>
          <span data-peek-title>{e.title.replace(/^Epic:\s*/i, "")}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-faint">
          {c.priority(e)}
          <span className="hidden sm:inline">{c.dimDot(e)}</span>
          <span className="tabular-nums md:hidden" data-epic-progress>
            {progressText(p)}
          </span>
        </span>
      </span>
      <span className="hidden w-52 shrink-0 items-center gap-2 md:flex" title={p.kind === "counted" ? `${PROGRESS_TOOLTIP}: ${p.done} of ${p.total} sub-issues completed` : undefined}>
        {p.kind === "counted" ? (
          <>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-active">
              <span className="block h-full rounded-full bg-brand-border" style={{ width: `${pct}%` }} />
            </span>
            <span className="w-24 text-right text-[12px] tabular-nums text-muted" data-epic-progress-text>
              {progressText(p)}
            </span>
          </>
        ) : (
          <span className="flex-1 text-right text-[12px] text-faint">{progressText(p)}</span>
        )}
      </span>
      <span className="hidden w-16 shrink-0 lg:block">{c.release(e)}</span>
      {c.assignee(e)}
      {c.updated(e)}
    </button>
  );
}

export function EpicsPage() {
  const { data } = useAppData();
  const open = useOpenIssue();
  const params = useSearchParams();
  const peeked = Number(params.get("issue")) || null;
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [sort, setSort] = useState<Sort>("progress");
  const epics = useMemo(() => {
    const list = data.issues.filter((i) => i.hasSubIssues && (state === "all" || i.state === state));
    const size = (i: ClientIssue) => i.subTotal ?? 0;
    // Counts GitHub hasn't reported yet sort last, never as 0% or 100%.
    const pct = (i: ClientIssue) => progressKey(i) ?? -1;
    return list.sort((a, b) =>
      sort === "progress" ? pct(b) - pct(a) || size(b) - size(a) : sort === "size" ? size(b) - size(a) : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [data.issues, state, sort]);

  const seg = <T extends string>(value: T, options: { key: T; label: string }[], onChange: (v: T) => void, label: string) => (
    <div role="radiogroup" aria-label={label} className="flex rounded-md bg-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`h-6 rounded px-2 text-[12px] font-medium ${value === o.key ? "bg-surface text-fg shadow-raised" : "text-muted hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <Page
      title="Epics"
      icon={<Icon name="epic" size={15} />}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          {seg(state, [{ key: "open", label: "Open" }, { key: "all", label: "All" }, { key: "closed", label: "Closed" }], setState, "State")}
          {seg(sort, [{ key: "progress", label: "Progress" }, { key: "size", label: "Size" }, { key: "updated", label: "Recent" }], setSort, "Sort")}
          <span className="ml-auto text-[12px] tabular-nums text-faint">{pluralize(epics.length, "epic")}</span>
        </div>
      }
    >
      {epics.length === 0 ? (
        <EmptyHint icon="epic" title="No epics" hint="Issues with sub-issues on GitHub appear here." />
      ) : (
        epics.map((e) => <EpicRow key={e.nodeId} e={e} peeked={e.number === peeked} onOpen={() => open(e.number)} />)
      )}
    </Page>
  );
}
