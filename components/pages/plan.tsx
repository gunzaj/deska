"use client";

// Release planning (IMPROVEMENTS F1): the current and the next Release side by
// side, their load by Team and person, and what is left over from Releases that
// have ended. With writes on, leftovers move to the next Release one by one or
// in bulk through the W1 outbox; with writes off the page gives a GitHub search.
import Link from "next/link";
import { EDITING_OFF } from "@/lib/client/edit";
import { useMemo, useState } from "react";
import { bulkEdit, describeChange, type BulkChange } from "@/lib/client/bulk";
import { encodeState, primaryDimension } from "@/lib/client/explorer";
import type { Filter } from "@/lib/views/view";
import { formatDate, lastDay, plainName } from "@/lib/client/format";
import { carryOver, githubSearch, githubSearchUrl, releaseLoad, type LoadRow, type ReleaseLoad } from "@/lib/client/planning";
import { PRESETS } from "@/lib/client/presets";
import type { ClientIssue, DimKey } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { Page } from "../app/shell";
import { Icon } from "../icons";
import { useIssueEdits } from "../issue/edits";
import { EmptyHint } from "../props";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { useToast } from "../ui/toast";
import { useOpenIssue } from "../app/open-issue";
import { useCells } from "../explorer/cells";

function Bars({ rows, href, title }: { rows: LoadRow[]; href: (r: LoadRow) => string; title: string }) {
  const max = Math.max(1, ...rows.map((r) => r.open + r.closed));
  if (!rows.length) return <p className="text-[12.5px] text-faint">Nothing planned.</p>;
  return (
    <ul aria-label={title} className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key}>
          <Link href={href(r)} className="group flex items-center gap-2 text-[12.5px]">
            <span className="w-32 shrink-0 truncate text-muted group-hover:text-fg">{plainName(r.label) || r.label}</span>
            <span className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-active" aria-hidden>
              <span className="h-full bg-brand-border" style={{ width: `${(r.open / max) * 100}%` }} />
              <span className="h-full" style={{ width: `${(r.closed / max) * 100}%`, background: "#8c6fe6" }} />
            </span>
            <span className="w-16 shrink-0 text-right tabular-nums text-faint">
              {r.open} open{r.closed ? ` · ${r.closed}` : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const exploreUrl = (releaseId: string, extra: { field: DimKey | "assignee"; values: string[] } | null) =>
  `/issues?s=${encodeState({ ...PRESETS.all, filters: [{ field: "release", op: "in", values: [releaseId] }, ...(extra ? [{ field: extra.field, op: "in" as const, values: extra.values }] : [])] as Filter[] })}`;

function LoadColumn({ load, label }: { load: ReleaseLoad; label: string }) {
  const { release: r } = load;
  const dim = primaryDimension(useAppData().data.meta);
  return (
    <section aria-label={`${label}: Release ${r.title}`} data-plan-release={r.id} className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-raised">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{label}</p>
      <h2 className="mt-0.5 flex items-center gap-2 text-[15px] font-semibold">
        <Link href={`/releases/${r.id}`} className="hover:underline">
          Release {r.title}
        </Link>
      </h2>
      <p className="mt-0.5 text-[12px] text-faint">
        {formatDate(r.startDate)} – {formatDate(lastDay(r.endDate))}
      </p>
      <p className="mt-3 text-[13px] text-muted" data-plan-counts>
        <span className="text-[20px] font-medium tabular-nums text-fg">{load.total}</span> issues · {load.open} open · {load.closed} closed
        {load.unassigned > 0 && <span className="text-warning"> · {load.unassigned} open unassigned</span>}
      </p>
      {dim && (
        <>
          <h3 className="mb-1.5 mt-4 text-[12px] font-semibold text-muted">By {dim.name}</h3>
          <Bars rows={load.byDim} title={`Release ${r.title} by ${dim.name}`} href={(row) => exploreUrl(r.id, row.key === "__none" ? null : { field: dim.key, values: [row.key] })} />
        </>
      )}
      <h3 className="mb-1.5 mt-4 text-[12px] font-semibold text-muted">By assignee</h3>
      <Bars rows={load.byAssignee} title={`Release ${r.title} by assignee`} href={(row) => exploreUrl(r.id, { field: "assignee", values: [row.label] })} />
    </section>
  );
}

export function ReleasePlanPage() {
  const { data, release } = useAppData();
  const { meta, issues } = data;
  const { edit, disabledReason } = useIssueEdits();
  const { toast } = useToast();
  const openIssue = useOpenIssue();
  const c = useCells();
  const current = meta.currentReleaseId ? release(meta.currentReleaseId) : undefined;
  const next = meta.nextReleaseId ? release(meta.nextReleaseId) : undefined;
  const loads = useMemo(() => ({ current: current && releaseLoad(issues, current, meta), next: next && releaseLoad(issues, next, meta) }), [issues, current, next, meta]);
  const left = useMemo(() => carryOver(issues, meta), [issues, meta]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirm, setConfirm] = useState<{ list: ClientIssue[]; text: string } | null>(null);
  const canWrite = meta.writeMode && !disabledReason && !!next;
  const numbers = left.map((i) => i.number);

  const change: BulkChange | null = next ? { kind: "set", field: "release", value: next.id, valueLabel: `Release ${next.title}` } : null;

  const move = async (list: ClientIssue[]) => {
    if (!change || !list.length) return;
    const todo = list.map((i) => ({ i, e: bulkEdit(i, change) })).filter((x) => x.e);
    const failed: ClientIssue[] = [];
    setProgress({ done: 0, total: todo.length });
    let n = 0;
    for (const { i, e } of todo) {
      const outcome = await edit(i, "release", e!.next, { quiet: true });
      if (outcome !== "done" && outcome !== "pending") failed.push(i);
      setProgress({ done: ++n, total: todo.length });
    }
    setProgress(null);
    setPicked(new Set());
    toast(
      failed.length
        ? { kind: "error", message: `${todo.length - failed.length} of ${todo.length} moved, ${failed.length} failed (${failed.map((f) => `#${f.number}`).join(", ")})` }
        : { message: `Moved ${todo.length} issue${todo.length === 1 ? "" : "s"} to Release ${next!.title}` },
    );
  };

  const ask = (list: ClientIssue[]) => {
    if (!change || !list.length) return;
    // Over 50 issues asks first, stating the count and the change (SPEC §5).
    if (list.length > 50) setConfirm({ list, text: `${describeChange(change)} on ${list.length} issues?` });
    else void move(list);
  };

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const chosen = left.filter((i) => picked.has(i.nodeId));

  return (
    <Page title="Release planning" icon={<Icon name="rocket" size={15} />} actions={<Link href="/releases" className={btn.ghost}>All releases</Link>}>
      <div className="space-y-8 p-4 md:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          {loads.current ? <LoadColumn load={loads.current} label="Current" /> : <EmptyHint icon="calendar" title="No current Release" />}
          {loads.next ? <LoadColumn load={loads.next} label="Next" /> : <EmptyHint icon="calendar" title="No next Release yet" hint="Planned issues will show here once the project has the next iteration." />}
        </div>

        <section aria-label="Carry-over">
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <h2 className="text-[12.5px] font-semibold text-muted">Carry-over</h2>
            <span className="text-[12px] text-faint" data-carry-count>
              {left.length} open issue{left.length === 1 ? "" : "s"} in Releases that have ended
            </span>
            <span className="flex-1" />
            {left.length > 0 && !canWrite && (
              <>
                <a href={githubSearchUrl(meta.repo, numbers)} target="_blank" rel="noopener noreferrer" className={btn.ghost}>
                  <Icon name="external" size={13} /> Search on GitHub
                </a>
                <button type="button" className={btn.ghost} onClick={() => void navigator.clipboard?.writeText(githubSearch(meta.repo, numbers))}>
                  <Icon name="link" size={13} /> Copy as GitHub search
                </button>
              </>
            )}
            {left.length > 0 && canWrite && (
              <button type="button" className={btn.primary} disabled={!!progress} onClick={() => ask(chosen.length ? chosen : left)}>
                {progress ? `${progress.done} / ${progress.total}` : chosen.length ? `Move ${chosen.length} selected to Release ${next!.title}` : `Move all ${left.length} to Release ${next!.title}`}
              </button>
            )}
          </div>
          {left.length === 0 ? (
            <EmptyHint icon="circleCheck" title="Nothing left over" hint="Every open issue is in a Release that is current or still ahead." />
          ) : (
            <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-surface">
              {left.map((i) => (
                <li key={i.nodeId} data-carry-row={i.number} className="flex min-h-10 items-center gap-3 px-3 py-1.5 text-[13px]">
                  {canWrite && <input type="checkbox" aria-label={`Select #${i.number}`} checked={picked.has(i.nodeId)} onChange={() => toggle(i.nodeId)} className="size-3.5 accent-brand" />}
                  {c.status(i)}
                  <span className="w-14 shrink-0">{c.id(i)}</span>
                  <button type="button" onClick={() => openIssue(i.number)} className="min-w-0 flex-1 truncate text-left hover:underline">
                    {i.title}
                  </button>
                  <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                    {c.priority(i)}
                    {c.release(i)}
                    {c.assignee(i)}
                  </span>
                  {canWrite && (
                    <button type="button" className={btn.ghost} disabled={!!progress} onClick={() => ask([i])} aria-label={`Move #${i.number} to Release ${next!.title}`}>
                      Move to next
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {left.length > 0 && !meta.writeMode && <p className="mt-2 text-[12px] text-faint">{meta.editOffReason ?? EDITING_OFF}. Move these on GitHub, or paste the search above to find them there.</p>}
        </section>
      </div>
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} label="Confirm move" width={420}>
        <div className="p-4">
          <p className="text-[14px] font-semibold">{confirm?.text}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={btn.ghost} onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={btn.primary}
              onClick={() => {
                const list = confirm!.list;
                setConfirm(null);
                void move(list);
              }}
            >
              Move
            </button>
          </div>
        </div>
      </Dialog>
    </Page>
  );
}
