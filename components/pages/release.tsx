"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { EDITING_OFF } from "@/lib/client/edit";
import { decodeState, runExplorer, type ExplorerState } from "@/lib/client/explorer";
import { keyboardBusy } from "@/lib/client/keyboard";
import { formatDate } from "@/lib/client/format";
import { PRESETS } from "@/lib/client/presets";
import { viewSchema, type Filter } from "@/lib/views/view";
import { connectionProblem, problemHint, useConnection } from "../app/connection";
import { useAppData } from "../app/provider";
import { Page } from "../app/shell";
import { useDefaultScope } from "../app/team-scope";
import { Explorer } from "../explorer/explorer";
import { Icon } from "../icons";
import { neighbour, releaseTeamFilters, sprintStats, sprintTiming } from "@/lib/client/sprint";
import type { ClientIssue, ClientRelease } from "@/lib/client/types";
import { ReleaseNotesButton } from "./release-notes";
import { ReleaseRisk } from "./release-risk";
import { SprintHeader } from "./sprint-header";
import { EmptyHint, Kbd } from "../props";
import { PickList, Popover, btn } from "../ui/popover";

/** Board by Status (default) or list; the list groups into Remaining, Done and Not planned (§4.5). */
const SPRINT_DEFAULTS: ExplorerState = { ...PRESETS.release, groupBy: "sprintState" };

const SUMMARY_KEY = "deska.release.summaryCollapsed";

/** The header and Risk section, collapsible so the board gets the room. The choice is remembered per browser. */
function ReleaseSummary({ sprint, all, scopeFilters, rows, filtered, filters }: { sprint: ClientRelease; all: ClientIssue[]; scopeFilters: Filter[]; rows: ClientIssue[]; filtered: boolean; filters: Filter[] }) {
  const { data } = useAppData();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SUMMARY_KEY) === "1");
    } catch {}
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SUMMARY_KEY, next ? "1" : "0");
    } catch {}
  };
  const stats = useMemo(() => sprintStats(rows, data.meta), [rows, data.meta]);
  const timing = sprintTiming(sprint, data.meta.today);
  const when = timing.phase === "current" ? `${timing.daysLeft} day${timing.daysLeft === 1 ? "" : "s"} left` : timing.phase === "upcoming" ? `starts in ${timing.startsIn} day${timing.startsIn === 1 ? "" : "s"}` : "ended";
  const toggleBtn = (
    <button type="button" onClick={toggle} aria-expanded={!collapsed} aria-controls="release-summary" data-summary-toggle className={`${btn.outline} shrink-0`} title={collapsed ? "Show summary" : "Hide summary"}>
      <Icon name={collapsed ? "chevronDown" : "chevronUp"} size={12} />
      {collapsed ? "Show summary" : "Hide summary"}
    </button>
  );
  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-line px-4 py-1.5 text-[12px]" data-summary-collapsed>
        {toggleBtn}
        <span className="font-semibold tabular-nums">
          {stats.done} / {stats.counted}
          {stats.pct != null && <span className="ml-1.5 font-normal text-muted">{stats.pct}%</span>}
        </span>
        <span className="text-muted">
          Remaining <span className="font-semibold tabular-nums text-fg">{stats.remaining}</span>
        </span>
        <span className="text-muted">{when}</span>
        {filtered && <span className="text-faint">filtered</span>}
      </div>
    );
  }
  return (
    <div id="release-summary" className="relative shrink-0">
      <SprintHeader sprint={sprint} all={all} rows={rows} filtered={filtered} filters={filters} />
      <ReleaseRisk release={sprint} issues={all} filters={scopeFilters} />
      <div className="absolute right-4 top-2.5">{toggleBtn}</div>
    </div>
  );
}

function ReleasePicker({ currentId }: { currentId: string }) {
  const { data } = useAppData();
  const router = useRouter();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { meta } = data;
  const prev = neighbour(meta.releases, currentId, -1);
  const next = neighbour(meta.releases, currentId, 1);
  // `[` and `]` step to the previous and next sprint by date.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "[" && e.key !== "]") || keyboardBusy(e)) return;
      const to = e.key === "[" ? prev : next;
      if (!to) return;
      e.preventDefault();
      router.push(`/releases/${to}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, router]);
  return (
    <>
      <button type="button" disabled={!prev} onClick={() => prev && router.push(`/releases/${prev}`)} className={btn.outline} aria-label="Previous sprint" title="Previous sprint ([)">
        <Icon name="chevronLeft" size={13} />
      </button>
      <button type="button" disabled={!next} onClick={() => next && router.push(`/releases/${next}`)} className={btn.outline} aria-label="Next sprint" title="Next sprint (])">
        <Icon name="chevronRight" size={13} />
      </button>
      <button ref={ref} type="button" onClick={() => setOpen(true)} className={btn.outline}>
        <Icon name="calendar" size={13} />
        Switch release
        <Icon name="chevronDown" size={12} className="text-faint" />
        <Kbd>[ ]</Kbd>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} align="end" width={260}>
        <PickList
          placeholder="Find a release…"
          items={[...meta.releases].reverse().map((r) => ({
            id: r.id,
            label: r.title,
            checked: r.id === currentId,
            hint: r.id === meta.currentReleaseId ? "current" : `${formatDate(r.startDate)}`,
          }))}
          onPick={(id) => {
            setOpen(false);
            router.push(`/releases/${id}`);
          }}
        />
      </Popover>
    </>
  );
}

export function ReleasePage({ id }: { id: string }) {
  const { data, release } = useAppData();
  const { status: connection } = useConnection();
  const params = useSearchParams();
  const teamScope = useDefaultScope();
  const r = release(id);
  const base = useMemo<Filter[]>(() => [{ field: "release", op: "in", values: [id] }], [id]);
  const inSprint = useMemo(() => data.issues.filter((i) => i.releaseId === id), [data.issues, id]);
  // The lower Explorer writes its filters to `s`; the overview reads the same
  // team filter from there so both sections agree when a filter changes.
  const urlFilters = useMemo(() => {
    const parsed = viewSchema.pick({ filters: true }).safeParse(decodeState(params?.get("s")));
    return parsed.success ? parsed.data.filters : [];
  }, [params]);
  const teamFilters = useMemo(() => releaseTeamFilters(urlFilters, base, teamScope.defaultScope, teamScope.scope), [urlFilters, base, teamScope.defaultScope, teamScope.scope]);
  // Only the team filter narrows the overview: search and Status narrow the list, not the totals it is measured against.
  const scopedInSprint = useMemo(() => (teamFilters.length ? runExplorer(inSprint, teamFilters, [], data.meta) : inSprint), [inSprint, teamFilters, data.meta]);
  if (!r) {
    return (
      <Page title="Release not found">
        <EmptyHint icon="calendar" title="This release does not exist in the project" />
      </Page>
    );
  }
  const isCurrent = r.id === data.meta.currentReleaseId;
  // An unreadable project is its own message, never an empty sprint (§3.3).
  if (inSprint.length === 0 && connectionProblem(connection)) {
    return (
      <Page title={`Release ${r.title}`} icon={<Icon name="calendar" size={15} />} actions={<ReleasePicker currentId={id} />}>
        <div data-sprint-unreadable>
          <EmptyHint
            icon="alert"
            title={connection!.message ?? "Can't read this project from GitHub"}
            hint={problemHint(connection!) ?? "The sprint's issues can't be loaded, so nothing is shown for it."}
          />
        </div>
      </Page>
    );
  }
  const readOnly = !data.meta.writeMode;

  return (
    <Explorer
      key={id}
      title={
        <span className="flex items-center gap-2">
          Release {r.title}
          {isCurrent && <span className="rounded-full bg-brand-soft px-1.5 py-px text-[10.5px] font-semibold text-brand-text">Current</span>}
        </span>
      }
      summary={({ rows, filtered, filters }) => (
        <ReleaseSummary sprint={r} all={scopedInSprint} scopeFilters={teamFilters} rows={rows} filtered={filtered} filters={filters} />
      )}
      icon={<Icon name="calendar" size={15} />}
      base={base}
      defaults={SPRINT_DEFAULTS}
      headerExtra={
        <>
          {readOnly && (
            // Planning stays visible, disabled, with the reason (§4.5).
            <button type="button" disabled data-planning-disabled title={data.meta.editOffReason ?? EDITING_OFF} className={btn.outline}>
              <Icon name="lock" size={12} />
              Bulk edit
              <span className="text-faint">{data.meta.editOffReason ?? EDITING_OFF}</span>
            </button>
          )}
          <ReleaseNotesButton release={r} issues={scopedInSprint} />
          <ReleasePicker currentId={id} />
        </>
      }
      dropRelease={id}
      emptyTitle="Nothing planned in this sprint yet"
      emptyHint="Issues get a Sprint on GitHub; they show up here after the next sync."
    />
  );
}
