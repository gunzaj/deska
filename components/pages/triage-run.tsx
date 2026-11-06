"use client";

// Triage mode (IMPROVEMENTS F3): one issue at a time from a triage queue, with
// its body and comments and the field pickers in reach of the keyboard.
//   1-4 Priority (1 = highest)   T Team   R Release   A assign
//   S or → next   ← previous   Z snooze   Esc exit
// The walk is fixed when it starts, so editing or snoozing never reorders it.
// With writes off the editing keys say so; snoozing still works (Deska only).
import Link from "next/link";
import { EDITING_OFF } from "@/lib/client/edit";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { addDaysIso, isSnoozed, priorityByKey, snoozePresets } from "@/lib/client/triage";
import { formatDate } from "@/lib/client/format";
import type { ClientIssue } from "@/lib/client/types";
import { useAppData } from "../app/provider";
import { Page } from "../app/shell";
import { keyboardBusy } from "@/lib/client/keyboard";
import { Icon } from "../icons";
import { openPicker } from "../issue/field-picker";
import { useIssueEdits } from "../issue/edits";
import { IssueDetailView } from "../issue/detail";
import { EmptyHint, Kbd } from "../props";
import { useSnoozes } from "../triage/snoozes";
import { Dialog } from "../ui/dialog";
import { btn } from "../ui/popover";
import { useToast } from "../ui/toast";
import { triageTabs, useQueueRows } from "../triage/queues";
import { primaryDimension, sprintOn } from "@/lib/client/explorer";

function SnoozeDialog({ open, onClose, today, onPick }: { open: boolean; onClose: () => void; today: string; onPick: (until: string) => void }) {
  const [custom, setCustom] = useState("");
  return (
    <Dialog open={open} onClose={onClose} label="Snooze until" width={380}>
      <div className="p-4">
        <p className="text-[14px] font-semibold">Snooze until…</p>
        <p className="mt-0.5 text-[12px] text-faint">It leaves your triage queues until then. Only you see this; nothing changes on GitHub.</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {snoozePresets(today).map((p) => (
            <button key={p.until} type="button" className={btn.outline} onClick={() => onPick(p.until)}>
              {p.label}
              <span className="ml-1 text-faint">{formatDate(p.until)}</span>
            </button>
          ))}
        </div>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (custom > today) onPick(custom);
          }}
        >
          <label className="text-[12.5px] text-muted" htmlFor="snooze-date">
            Pick a date
          </label>
          <input id="snooze-date" type="date" min={addDaysIso(today, 1)} value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 rounded-md border border-line bg-field px-2 text-[13px]" />
          <button type="submit" className={btn.primary} disabled={!(custom > today)}>
            Snooze
          </button>
        </form>
      </div>
    </Dialog>
  );
}

export function TriageRunPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { data, byNodeId } = useAppData();
  const TRIAGE_TABS = triageTabs(data.meta);
  const tab = TRIAGE_TABS.find((t) => t.id === params.get("tab")) ?? TRIAGE_TABS[0]!;
  // T opens the first mapped dimension's picker (e.g. a team field), R the Sprint's.
  const dim = primaryDimension(data.meta);
  const sprints = sprintOn(data.meta);
  const { edit } = useIssueEdits();
  const { snoozes, snooze, unsnooze } = useSnoozes();
  const { toast } = useToast();
  const queue = useQueueRows(tab);
  // The walk is fixed when it starts.
  const [ids] = useState<string[]>(() => queue.map((i) => i.nodeId));
  const [index, setIndex] = useState(0);
  const [snoozing, setSnoozing] = useState(false);
  const today = data.meta.today;
  const issue: ClientIssue | undefined = ids[index] ? byNodeId.get(ids[index]!) : undefined;
  const exitHref = `/triage?tab=${tab.id}`;
  const priorities = priorityByKey(data.meta);

  const go = useCallback((d: number) => setIndex((i) => Math.max(0, Math.min(ids.length, i + d))), [ids.length]);

  const pick = (until: string) => {
    if (!issue) return;
    setSnoozing(false);
    void snooze(issue.nodeId, until);
    toast({ message: `Snoozed #${issue.number} until ${formatDate(until)}`, action: { label: "Undo", run: () => void unsnooze(issue.nodeId) } });
    go(1);
  };

  // Keys read the latest state without re-binding on every render.
  const state = useRef({ issue, priorities, go, exitHref });
  state.current = { issue, priorities, go, exitHref };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || keyboardBusy(e)) return;
      const { issue: cur, priorities: prios, go: step, exitHref: out } = state.current;
      if (e.key === "Escape") {
        e.preventDefault();
        router.push(out);
        return;
      }
      if (e.key === "s" || e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (!cur) {
        return;
      } else if (e.key === "z") {
        e.preventDefault();
        setSnoozing(true);
      } else if ((e.key === "t" && dim) || (e.key === "r" && sprints) || e.key === "a") {
        e.preventDefault();
        if (!data.meta.writeMode) toast({ message: data.meta.editOffReason ?? EDITING_OFF });
        else openPicker(cur.nodeId, e.key === "t" ? dim!.key : e.key === "r" ? "release" : "assignees");
      } else if (/^[1-4]$/.test(e.key)) {
        e.preventDefault();
        const option = prios[Number(e.key) - 1];
        if (option) void edit(cur, "priority", option.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, edit, toast, data.meta.writeMode, data.meta.editOffReason, dim, sprints]);

  const done = index >= ids.length;
  const snoozedNow = issue && isSnoozed(snoozes.get(issue.nodeId), today);

  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          Triage <span className="font-normal text-muted">· {tab.label}</span>
          {ids.length > 0 && !done && (
            <span className="font-normal tabular-nums text-faint" data-triage-progress aria-live="polite">
              {index + 1} / {ids.length}
            </span>
          )}
        </span>
      }
      icon={<Icon name="inbox" size={15} />}
      actions={
        <>
          <button type="button" className={btn.icon} aria-label="Previous issue" disabled={index === 0} onClick={() => go(-1)}>
            <Icon name="chevronLeft" size={15} />
          </button>
          <button type="button" className={btn.ghost} disabled={done} onClick={() => go(1)}>
            Skip
          </button>
          <button type="button" className={btn.ghost} disabled={!issue} onClick={() => setSnoozing(true)}>
            <Icon name="clock" size={13} />
            Snooze
          </button>
          <Link href={exitHref} className={btn.outline}>
            Exit
          </Link>
        </>
      }
    >
      {ids.length === 0 ? (
        <EmptyHint icon="circleCheck" title="Inbox zero" hint={`${tab.hint} Nothing here right now.`} action={<Link href={exitHref} className={btn.outline}>Back to triage</Link>} />
      ) : done ? (
        <EmptyHint icon="circleCheck" title={`That was all ${ids.length}`} hint="Nothing left to look at in this queue." action={<Link href={exitHref} className={btn.primary} data-triage-finished>Back to triage</Link>} />
      ) : (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto" data-triage-issue={issue?.number}>
            {issue ? <IssueDetailView key={issue.number} number={issue.number} mode="page" /> : <EmptyHint icon="search" title="This issue is no longer in the cache" hint="Skip to the next one." />}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[12px] text-faint" aria-label="Triage keys">
            {snoozedNow && <span className="text-warning">Snoozed</span>}
            <span><Kbd>1</Kbd>–<Kbd>{Math.max(1, Math.min(4, priorities.length))}</Kbd> priority</span>
            {dim && (
              <span>
                <Kbd>T</Kbd> {dim.name.toLowerCase()}
              </span>
            )}
            {sprints && (
              <span>
                <Kbd>R</Kbd> release
              </span>
            )}
            <span><Kbd>A</Kbd> assign</span>
            <span><Kbd>S</Kbd> / <Kbd>→</Kbd> skip</span>
            <span><Kbd>←</Kbd> back</span>
            <span><Kbd>Z</Kbd> snooze</span>
            <span><Kbd>Esc</Kbd> exit</span>
            {!data.meta.writeMode && <span className="text-warning">{data.meta.editOffReason ?? EDITING_OFF}: read-only walk-through, snoozing still works.</span>}
          </div>
        </div>
      )}
      <SnoozeDialog open={snoozing} onClose={() => setSnoozing(false)} today={today} onPick={pick} />
    </Page>
  );
}
