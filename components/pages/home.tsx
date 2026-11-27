"use client";

// Home (HOME-SPEC §3–§5): the cockpit. Everything shown is decided by the pure
// `homeModel`; this file only renders it. Home reads what the client already
// has and changes nothing but a local task's completion.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarPanel } from "../calendar/calendar-panel";
import { useCalendar } from "../calendar/use-calendar";
import { countMeetings } from "@/lib/calendar/layout";
import { optionColor } from "@/lib/client/colors";
import { EDITING_OFF } from "@/lib/client/edit";
import { formatDate, lastDay, longAgo, plainName } from "@/lib/client/format";
import { CUSTOMIZE_HOME_EVENT, greeting, homeModel, longDate, RISK_LABEL, type HomeModel, type HomeSprint, type HomeTab, type HomeTabId, type HomeTile } from "@/lib/client/home";
import { moveHomePanel, type HomePanel, type HomeSize } from "@/lib/tasks/model";
import { progressText } from "@/lib/client/progress";
import type { ClientIssue } from "@/lib/client/types";
import { DefaultScopeChip } from "../app/default-scope-chip";
import { useOpenIssue } from "../app/open-issue";
import { useAppData } from "../app/provider";
import { Page } from "../app/shell";
import { useTasksOnly } from "../app/tasks-only";
import { useDefaultScope } from "../app/team-scope";
import { useCells } from "../explorer/cells";
import { Icon } from "../icons";
import { openCreateIssue } from "../issue/create-issue";
import { Kbd, OptionDot } from "../props";
import { TaskErrorBanner, TaskListState } from "../tasks/bits";
import { useToday } from "../tasks/notifications";
import { PlanMyDay } from "../tasks/plan-my-day";
import { useTasks } from "../tasks/store";
import { subCounts, TaskRow } from "../tasks/task-row";
import { useSnoozes } from "../triage/snoozes";
import { btn } from "../ui/popover";
import { useWatchlist, type WatchKind } from "../watch/store";
import { HiddenPanels, HomeEditBar, PANEL_LABELS, useHomeLayout } from "./home-customize";
import { useScopeAdded } from "./release-risk";

const TAB_KEY = "deska.home.tab";
/** A panel's width on the 12-column grid at 900 px and wider; one column below that. */
const SPAN: Record<HomeSize, string> = {
  third: "min-[900px]:col-span-4",
  half: "min-[900px]:col-span-6",
  wide: "min-[900px]:col-span-8",
  full: "min-[900px]:col-span-12",
};

/** Whether AI may run: "Plan my day" is hidden while it is off. A local read; nothing is sent to a model. */
function useAiReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/ai/status", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ ready: boolean }>) : null))
      .then((s) => live && setReady(Boolean(s?.ready)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

function Panel({ id, title, meta, action, children }: { id: HomePanel; title: ReactNode; meta?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={PANEL_LABELS[id]} data-home-panel={id} className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-raised">
      <header className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-1.5">
        <h2 className="min-w-0 truncate text-[13.5px] font-semibold">{title}</h2>
        {meta && <span className="min-w-0 truncate text-[12px] text-faint">{meta}</span>}
        {action && <span className="ml-auto flex shrink-0 items-center gap-1.5">{action}</span>}
      </header>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="px-4 py-6 text-center text-[12.5px] text-muted" data-home-empty>
    {children}
  </p>
);

const more = "text-[12px] font-medium text-brand-text hover:underline";

function Tile({ tile }: { tile: HomeTile }) {
  return (
    <Link href={tile.href} data-home-tile={tile.id} className="min-w-0 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-raised transition-colors hover:border-line-field hover:bg-hover">
      <p className="truncate text-[12px] font-medium text-muted">{tile.label}</p>
      <p className="mt-1 text-[24px] font-medium leading-none tracking-tight tabular-nums" data-tile-value>
        {tile.value}
      </p>
      <p className={`mt-1.5 text-[12px] ${tile.critical ? "text-critical" : "text-faint"}`} data-tile-sub>
        {tile.sub || " "}
      </p>
    </Link>
  );
}

/** An issue row as on lists: number, title, Status, Priority. Opens the side panel. With a `note` (why the row is here) the Status shows as its icon only. */
function IssueRow({ issue, note }: { issue: ClientIssue; note?: ReactNode }) {
  const cells = useCells();
  const open = useOpenIssue();
  return (
    <li className="border-b border-line-soft last:border-b-0">
      <button type="button" data-tab-issue={issue.number} data-home-issue={issue.number} onClick={() => open(issue.number)} className="flex min-h-10 w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-hover">
        {cells.status(issue)}
        <span className="shrink-0">{cells.id(issue)}</span>
        <span className="min-w-0 flex-1 truncate text-[13.5px]">{issue.title}</span>
        {note}
        {!note && issue.statusName && <span className="hidden shrink-0 rounded-full border border-line px-2 text-[11.5px] text-muted sm:inline">{plainName(issue.statusName) || issue.statusName}</span>}
        <span className="shrink-0">{cells.priority(issue)}</span>
      </button>
    </li>
  );
}

function MyWork({ tabs }: { tabs: HomeTab[] }) {
  const { tasks, loaded } = useTasks();
  const { today, now } = useToday();
  const [picked, setPicked] = useState<HomeTabId>("today");
  // The last tab chosen is remembered per install; a blocked storage falls back to Today.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as HomeTabId | null;
      if (saved) setPicked(saved);
    } catch {}
  }, []);
  const pick = (id: HomeTabId) => {
    setPicked(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {}
  };
  const subs = useMemo(() => subCounts(tasks as Parameters<typeof subCounts>[0]), [tasks]);
  // A remembered "This sprint" with no sprint now: Today.
  const tab = tabs.find((t) => t.id === picked) ?? tabs[0]!;
  const waiting = tab.kind === "tasks" && !loaded;

  return (
    <Panel
      id="work"
      title="My work"
      action={
        tab.more && (
          <Link href={tab.href} className={more} data-home-view-all>
            View all {tab.count}
          </Link>
        )
      }
    >
      <div role="tablist" aria-label="My work" className="flex gap-0.5 overflow-x-auto border-b border-line px-2.5 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`home-tab-${t.id}`}
            aria-selected={t.id === tab.id}
            aria-controls="home-tabpanel"
            onClick={() => pick(t.id)}
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium ${t.id === tab.id ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg"}`}
          >
            {t.label}
            <span className="tabular-nums text-faint" data-tab-count>
              {t.kind === "tasks" && !loaded ? "…" : t.count}
            </span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id="home-tabpanel" aria-labelledby={`home-tab-${tab.id}`} data-home-tab={tab.id}>
        <TaskErrorBanner />
        {waiting ? (
          <TaskListState />
        ) : tab.count === 0 ? (
          <Empty>{tab.empty}</Empty>
        ) : tab.kind === "tasks" ? (
          <ul>
            {tab.rows.map((t, i) => (
              <TaskRow key={t.id} task={t} today={today} now={now} subs={subs.get(t.id)} tabbable={i === 0} />
            ))}
          </ul>
        ) : (
          <ul>
            {tab.rows.map((i) => (
              <IssueRow key={i.nodeId} issue={i} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function SprintPanel({ sprint }: { sprint: HomeSprint }) {
  const open = useOpenIssue();
  if (sprint.kind === "none") {
    return (
      <Panel
        id="sprint"
        title="Current sprint"
        action={
          <Link href="/releases" className={more}>
            Releases
          </Link>
        }
      >
        <Empty>
          No sprint in progress
          {sprint.next && (
            <span className="mt-1 block text-faint" data-home-next-sprint>
              {sprint.next.title} starts {formatDate(sprint.next.startDate)}
            </span>
          )}
        </Empty>
      </Panel>
    );
  }
  const { release, stats, segments } = sprint;
  return (
    <Panel
      id="sprint"
      title={release.title}
      meta={
        <>
          {formatDate(release.startDate)} – {formatDate(lastDay(release.endDate))} · <span data-home-days-left>{sprint.daysLeft} day{sprint.daysLeft === 1 ? "" : "s"} left</span>
        </>
      }
      action={
        <>
          <DefaultScopeChip />
          <Link href={sprint.href} className={more}>
            Open sprint
          </Link>
        </>
      }
    >
      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-[22px] font-medium leading-none tracking-tight tabular-nums" data-home-sprint-done>
            {stats.done} / {stats.counted}
            {stats.pct != null && <span className="ml-2 text-[15px] text-muted">{stats.pct}%</span>}
          </p>
          <p className="text-[12px] text-muted">done</p>
          {sprint.scopeLabel && (
            <p className="text-[12px] text-faint" data-home-sprint-scope>
              {sprint.scopeLabel} (filtered)
            </p>
          )}
          {sprint.added != null && sprint.added > 0 && (
            <p className="ml-auto text-[12px] text-muted" data-home-sprint-added title="Put into the sprint after it started">
              +{sprint.added} added since start
            </p>
          )}
        </div>
        <div className="flex h-2 gap-px overflow-hidden rounded-full bg-active" role="img" aria-label={stats.pct == null ? "Nothing to count yet" : `${stats.done} of ${stats.counted} done`}>
          {segments.map((s) => (
            <span key={s.key} className="h-full" style={{ flexGrow: s.n, flexBasis: 0, background: s.color ? optionColor(s.color) : "var(--fg-faint)" }} />
          ))}
        </div>
        {segments.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted" aria-label="Sprint issues by Status" data-home-sprint-legend>
            {segments.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <OptionDot color={s.color} size={7} />
                {s.name}
                <span className="tabular-nums text-faint">{s.n}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-line px-4 py-2.5" data-home-risk>
        <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <Icon name="flag" size={13} className={sprint.riskCount ? "text-warning" : "text-faint"} />
          At risk
          <span className="font-normal text-faint">{sprint.riskCount === 0 ? "nothing flagged" : `${sprint.riskCount} flagged`}</span>
        </h3>
        {sprint.risks.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {sprint.risks.map((r) => (
              <li key={r.issue.nodeId} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12.5px]">
                <button type="button" data-tab-issue={r.issue.number} onClick={() => open(r.issue.number)} className="min-w-0 max-w-full truncate text-left hover:underline">
                  <span className="text-faint">#{r.issue.number}</span> {r.issue.title}
                </button>
                <span className="text-[11.5px] text-faint">{r.rules.map((x) => RISK_LABEL[x]).join(" · ")}</span>
              </li>
            ))}
            {sprint.riskCount > sprint.risks.length && <li className="text-[11.5px] text-faint">and {sprint.riskCount - sprint.risks.length} more</li>}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function Attention({ rows }: { rows: NonNullable<HomeModel["attention"]> }) {
  return (
    <Panel
      id="attention"
      title="Needs attention"
      action={
        <Link href="/triage" className={more}>
          Open triage
        </Link>
      }
    >
      {rows.length === 0 ? (
        <Empty>Nothing needs you right now.</Empty>
      ) : (
        <ul>
          {rows.map((r) => (
            <IssueRow key={r.issue.nodeId} issue={r.issue} note={<span className="shrink-0 text-[11.5px] text-faint" data-attention={r.reason}>{r.text}</span>} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Changes({ changes }: { changes: NonNullable<HomeModel["changes"]> }) {
  const { byNodeId } = useAppData();
  const { markSeen } = useWatchlist();
  const open = useOpenIssue();
  const split = (key: string): [WatchKind, string] => [key.slice(0, key.indexOf(":")) as WatchKind, key.slice(key.indexOf(":") + 1)];
  return (
    <Panel
      id="changes"
      title="What changed"
      action={
        <>
          {changes.watchKeys.length > 0 && (
            <button type="button" className={btn.ghost} data-home-mark-seen onClick={() => void Promise.all(changes.watchKeys.map((k) => markSeen(...split(k))))}>
              Mark all seen
            </button>
          )}
          <Link href="/watching" className={more}>
            Watching
          </Link>
        </>
      }
    >
      {changes.rows.length === 0 ? (
        <Empty>Nothing new in the issues you watch.</Empty>
      ) : (
        <ul className="divide-y divide-line-soft">
          {changes.rows.map((c, n) => {
            const issue = byNodeId.get(c.issueNodeId);
            return (
              <li key={`${c.issueNodeId}:${c.line.field}:${c.observedAt}:${n}`} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2 text-[12.5px]" data-change={c.line.field}>
                {issue ? (
                  <button
                    type="button"
                    data-tab-issue={issue.number}
                    className="min-w-0 max-w-full truncate text-left hover:underline"
                    onClick={() => {
                      open(issue.number);
                      void markSeen("issue", c.issueNodeId);
                    }}
                  >
                    <span className="text-faint">#{issue.number}</span> {issue.title}
                  </button>
                ) : (
                  <span className="text-faint">an issue not in the cache</span>
                )}
                <span className="text-muted">
                  <span className="text-faint">{c.line.label}:</span> {c.line.text}
                </span>
                <span className="ml-auto text-[11.5px] text-faint">
                  {c.source === "deska" ? "by you in Deska · " : ""}
                  {longAgo(c.observedAt)}
                </span>
              </li>
            );
          })}
          {changes.total > changes.rows.length && <li className="px-4 py-2 text-[11.5px] text-faint">and {changes.total - changes.rows.length} more</li>}
        </ul>
      )}
    </Panel>
  );
}

function Epics({ rows }: { rows: NonNullable<HomeModel["epics"]> }) {
  const open = useOpenIssue();
  return (
    <Panel
      id="epics"
      title="Epics in this sprint"
      action={
        <Link href="/epics" className={more}>
          All epics
        </Link>
      }
    >
      {rows.length === 0 ? (
        <Empty>No epics in this sprint.</Empty>
      ) : (
        <ul>
          {rows.map(({ issue, progress }) => (
            <li key={issue.nodeId} className="border-b border-line-soft last:border-b-0">
              <button type="button" data-tab-issue={issue.number} onClick={() => open(issue.number)} className="flex min-h-10 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left hover:bg-hover">
                <span className="min-w-0 flex-1 truncate text-[13.5px]">
                  <span className="font-mono text-[11.5px] tabular-nums text-faint">#{issue.number}</span> {issue.title}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[11.5px] tabular-nums text-muted" data-sub-progress={progress.kind}>
                  {progress.kind === "counted" && (
                    <span aria-hidden className="block h-1.5 w-16 overflow-hidden rounded-full bg-active">
                      <span className="block h-full rounded-full bg-brand-border" style={{ width: `${progress.pct}%` }} />
                    </span>
                  )}
                  {progressText(progress)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function HomePage() {
  const tasksOnly = useTasksOnly();
  const { data } = useAppData();
  const { meta } = data;
  const { tasks, projects, openCompose } = useTasks();
  const { today, now, tz } = useToday();
  const feed = useCalendar(today, tz);
  const { scope } = useDefaultScope();
  const { snoozes } = useSnoozes();
  const { unseen, changes } = useWatchlist();
  const aiReady = useAiReady();
  const { panels, save } = useHomeLayout();
  const [editing, setEditing] = useState(false);
  // The panel being dragged, and the panel it would land on (before or after it).
  // The ref is the source of truth for the drop handlers: the browser fires
  // dragover before React has committed the state set in dragstart.
  const dragRef = useRef<HomePanel | null>(null);
  const [drag, setDrag] = useState<HomePanel | null>(null);
  const [over, setOver] = useState<{ id: HomePanel; after: boolean } | null>(null);
  useEffect(() => {
    const show = () => setEditing(true);
    window.addEventListener(CUSTOMIZE_HOME_EVENT, show);
    return () => window.removeEventListener(CUSTOMIZE_HOME_EVENT, show);
  }, []);

  const current = tasksOnly ? null : (meta.releases.find((r) => r.id === meta.currentReleaseId) ?? null);
  const scopeAdded = useScopeAdded(current);
  const model = useMemo(
    () =>
      homeModel({
        data,
        tasks,
        projects,
        today,
        scope,
        tasksOnly,
        snoozes,
        watch: { unseen, changes },
        scopeAdded,
        calendar: { connected: feed.data?.connected === true, meetings: countMeetings(feed.data?.events ?? [], today, tz) },
      }),
    [data, tasks, projects, today, scope, tasksOnly, snoozes, unseen, changes, scopeAdded, feed.data, tz],
  );

  const blocks: Record<HomePanel, ReactNode> = {
    work: <MyWork key="work" tabs={model.tabs} />,
    sprint: model.sprint && <SprintPanel key="sprint" sprint={model.sprint} />,
    epics: model.epics && <Epics key="epics" rows={model.epics} />,
    calendar: <CalendarPanel key="calendar" feed={feed} today={today} tz={tz} />,
    attention: model.attention && <Attention key="attention" rows={model.attention} />,
    changes: model.changes && <Changes key="changes" changes={model.changes} />,
  };
  // What this install can show at all: Customize offers only those.
  const available = useMemo(() => {
    const has: Record<HomePanel, boolean> = { work: true, sprint: model.sprint != null, epics: model.epics != null, calendar: true, attention: model.attention != null, changes: model.changes != null };
    return new Set((Object.keys(has) as HomePanel[]).filter((id) => has[id]));
  }, [model]);
  const shown = panels.filter((p) => !p.hidden && available.has(p.id));
  const hidden = panels.filter((p) => p.hidden && available.has(p.id));
  // A two-thirds panel only shares a row with a third. With none shown (tasks-only
  // mode, or the narrow panels hidden) it fills the row instead of leaving a gap.
  const noThird = !shown.some((p) => p.size === "third");
  const span = (size: HomeSize) => SPAN[size === "wide" && noThird ? "full" : size];
  const writeOff = !meta.writeMode;

  // Every change goes straight to prefs, as in Customize sidebar.
  const apply = (next: typeof panels) => void save(next);
  const move = (id: HomePanel, by: -1 | 1) => {
    const other = shown[shown.findIndex((p) => p.id === id) + by];
    if (other) apply(moveHomePanel(panels, id, other.id, by > 0));
  };
  const resize = (id: HomePanel, size: HomeSize) => apply(panels.map((p) => (p.id === id ? { ...p, size } : p)));
  const setHidden = (id: HomePanel, value: boolean) => apply(panels.map((p) => (p.id === id ? { ...p, hidden: value } : p)));
  const drop = (target: HomePanel, after: boolean) => {
    const moving = dragRef.current;
    if (moving && moving !== target) apply(moveHomePanel(panels, moving, target, after));
    dragRef.current = null;
    setDrag(null);
    setOver(null);
  };

  return (
    <Page
      title="Home"
      icon={<Icon name="home" size={15} />}
      actions={
        <>
          {aiReady && <PlanMyDay />}
          {!tasksOnly && (
            <button type="button" onClick={() => openCreateIssue()} disabled={writeOff} title={writeOff ? (meta.editOffReason ?? EDITING_OFF) : "Create issue"} aria-label="Create issue" className={btn.outline} data-home-create-issue>
              <Icon name="plus" size={13} />
              <span className="hidden sm:inline">Create issue</span>
            </button>
          )}
          <button type="button" onClick={() => openCompose()} className={btn.primary} aria-label="Add task">
            <Icon name="plus" size={14} />
            <span className="hidden sm:inline">Add task</span>
            <span className="hidden md:inline">
              <Kbd>Q</Kbd>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setEditing((x) => !x)}
            className={`${btn.icon} ${editing ? "bg-active text-fg" : ""}`}
            aria-label="Customize Home"
            aria-pressed={editing}
            title={editing ? "Done customizing Home" : "Customize Home"}
          >
            <Icon name="sliders" size={14} />
          </button>
        </>
      }
    >
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-home>
        <div>
          <p className="text-[20px] font-semibold tracking-tight" data-home-greeting>
            {greeting(now)}
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {longDate(today)}
            {model.context && (
              <>
                {" · "}
                <span data-home-context>{model.context}</span>
              </>
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-home-tiles>
          {model.tiles.map((t) => (
            <Tile key={t.id} tile={t} />
          ))}
        </div>

        {editing && (
          <div data-home-edit-toolbar className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-3 py-2 shadow-raised">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
              <Icon name="sliders" size={14} />
              Customize Home
            </span>
            <span className="text-[12px] text-faint">Drag a panel by its handle, choose a width, or hide it.</span>
            <span className="ml-auto flex items-center gap-1.5">
              <button type="button" onClick={() => void save(null)} className="rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg">
                Reset
              </button>
              <button type="button" onClick={() => setEditing(false)} className={btn.outline}>
                Done
              </button>
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 min-[900px]:grid-flow-row-dense min-[900px]:grid-cols-12" data-home-grid>
          {shown.map((p, i) => {
            const line = drag && over?.id === p.id ? (over.after ? "after" : "before") : null;
            return (
              <div
                key={p.id}
                data-home-widget={p.id}
                data-size={p.size}
                className={`relative col-span-1 min-w-0 ${span(p.size)} ${drag === p.id ? "opacity-50" : ""}`}
                onDragOver={
                  editing
                    ? (e) => {
                        const moving = dragRef.current;
                        if (!moving || moving === p.id) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        const r = e.currentTarget.getBoundingClientRect();
                        const after = e.clientY > r.top + r.height / 2;
                        // dragover fires many times a second: keep the state object while nothing changed.
                        setOver((was) => (was?.id === p.id && was.after === after ? was : { id: p.id, after }));
                      }
                    : undefined
                }
                onDrop={
                  editing
                    ? (e) => {
                        if (!dragRef.current) return;
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        drop(p.id, e.clientY > r.top + r.height / 2);
                      }
                    : undefined
                }
              >
                {line && <span aria-hidden className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-brand-border ${line === "after" ? "-bottom-2" : "-top-2"}`} />}
                {editing && (
                  <HomeEditBar
                    id={p.id}
                    size={p.size}
                    first={i === 0}
                    last={i === shown.length - 1}
                    dragging={drag === p.id}
                    onMove={(by) => move(p.id, by)}
                    onSize={(size) => resize(p.id, size)}
                    onHide={() => setHidden(p.id, true)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", p.id);
                      e.dataTransfer.effectAllowed = "move";
                      dragRef.current = p.id;
                      setDrag(p.id);
                    }}
                    onDragEnd={() => {
                      dragRef.current = null;
                      setDrag(null);
                      setOver(null);
                    }}
                  />
                )}
                {blocks[p.id]}
              </div>
            );
          })}
        </div>

        {editing && <HiddenPanels rows={hidden} onShow={(id) => setHidden(id, false)} />}
      </div>
    </Page>
  );
}
