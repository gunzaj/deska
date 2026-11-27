// Home (HOME-SPEC §3–§5): what needs the viewer right now, across personal
// tasks and GitHub work. Pure: the page only renders what this returns, and
// every number here comes from the definition its own page uses, so a tile can
// never disagree with the page it opens.
import { dueCount } from "../tasks/counts";
import { addDays } from "../tasks/dates";
import { compareTasks, type Task, type TaskProject } from "../tasks/model";
import type { FieldChange } from "../sync/changes";
import type { Filter } from "../views/view";
import { encodeState, runExplorer, sprintOn, type ExplorerState } from "./explorer";
import { plainName } from "./format";
import { OPEN, PRESETS } from "./presets";
import { progressKey, subProgress, type SubProgress } from "./progress";
import { releaseRisk } from "./risk";
import { sprintBucket, sprintStats, sprintTiming, type SprintStats } from "./sprint";
import { withDefaultScope, type DefaultScope } from "./team-scope";
import { releasesOn } from "./today";
import { queueRows, triageTabs } from "./triage-queues";
import type { ClientData, ClientIssue, ClientMeta, ClientRelease } from "./types";
import { describeFieldChange, isShownChange, type ChangeLine } from "./watch";

/** Fired by the ⌘K palette to open Customize Home. */
export const CUSTOMIZE_HOME_EVENT = "deska:customize-home";

/** Rows a My work tab shows before "View all N". */
export const TAB_ROWS = 8;
export const RISK_ROWS = 5;
export const ATTENTION_ROWS = 6;
/** The newest issues of the Needs triage queue shown under Needs attention. */
export const TRIAGE_NEW_ROWS = 3;
export const CHANGE_ROWS = 5;
export const EPIC_ROWS = 5;
/** One of my open issues is "quiet" after this many days without an update [Default H-E]. */
export const QUIET_DAYS = 14;
/** The Upcoming tab: tomorrow through this many days ahead. */
export const UPCOMING_DAYS = 7;

const ME: Filter = { field: "assignee", op: "in", values: ["me"] };

export type HomeInput = {
  data: ClientData;
  tasks: readonly Task[];
  projects: readonly Pick<TaskProject, "id" | "archived">[];
  /** The viewer's day, YYYY-MM-DD. */
  today: string;
  /** The default team scope in force, or null (none, or switched off for the session). */
  scope: DefaultScope | null;
  /** The user skipped GitHub: only the task parts show. */
  tasksOnly: boolean;
  /** Triage snoozes: node ID → first day back. */
  snoozes?: ReadonlyMap<string, string>;
  /** The watchlist store's unseen count and changes per watch key. */
  watch?: { unseen: number; changes: Readonly<Record<string, readonly FieldChange[]>> };
  /** Issues put into the current sprint after it started (`useScopeAdded`). */
  scopeAdded?: { ids: readonly string[]; loaded: boolean };
  /** Today's meetings, when calendar reading is on (CALENDAR-SPEC §3.2): the context line says how many. */
  calendar?: { connected: boolean; meetings: number };
};

export type HomeTileId = "due" | "mine" | "triage" | "watching" | "sprint";
export type HomeTile = { id: HomeTileId; label: string; value: string; sub: string; critical?: boolean; href: string };

export type HomeTabId = "today" | "sprint" | "upcoming";
type TabBase = { label: string; count: number; more: boolean; href: string; empty: string };
export type HomeTab = (TabBase & { id: "today" | "upcoming"; kind: "tasks"; rows: Task[] }) | (TabBase & { id: "sprint"; kind: "issues"; rows: ClientIssue[] });

export type RiskRule = "noOwner" | "scopeAdded";
export const RISK_LABEL: Record<RiskRule, string> = { noOwner: "Top priority, no assignee", scopeAdded: "Added after the start" };
export type HomeRisk = { issue: ClientIssue; rules: RiskRule[] };

/** One part of the sprint bar: the counted issues with one Status option (or with none). */
export type SprintSegment = { key: string; name: string; color: string | null; n: number };

export type HomeSprint =
  | { kind: "none"; next: ClientRelease | null }
  | {
      kind: "current";
      release: ClientRelease;
      daysLeft: number;
      stats: SprintStats;
      segments: SprintSegment[];
      /** Issues added since the start; null until that is loaded. */
      added: number | null;
      risks: HomeRisk[];
      riskCount: number;
      /** "Platform · 12 / 30" when the default scope narrows the numbers; null otherwise. */
      scopeLabel: string | null;
      href: string;
    };

export type AttentionReason = "triage" | "quiet";
export type HomeAttention = { issue: ClientIssue; reason: AttentionReason; text: string };
export type HomeChange = { watchKey: string; issueNodeId: string; observedAt: string; source: FieldChange["source"]; line: ChangeLine };
export type HomeEpic = { issue: ClientIssue; progress: Exclude<SubProgress, { kind: "none" }> };

export type HomeModel = {
  /** "Sprint 23 ends in 4 days · 3 issues need triage"; "" when neither part applies. */
  context: string;
  tiles: HomeTile[];
  tabs: HomeTab[];
  /** Null: no Sprint field mapped (or tasks-only), so the panel is hidden. */
  sprint: HomeSprint | null;
  /** Null in tasks-only mode. */
  attention: HomeAttention[] | null;
  changes: { rows: HomeChange[]; total: number; watchKeys: string[] } | null;
  /** Null without a sprint in progress. */
  epics: HomeEpic[] | null;
};

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** "Good morning / afternoon / evening" for a wall-clock time (HH:mm) in the viewer's zone. */
export function greeting(now: string): string {
  const hour = Number(now.slice(0, 2));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** "Wednesday 25 November" for a YYYY-MM-DD date. */
export function longDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/** Open tasks outside archived projects: what Today, Upcoming and the Today badge count from. */
function liveTasks(tasks: readonly Task[], projects: HomeInput["projects"]): Task[] {
  const archived = new Set(projects.filter((p) => p.archived).map((p) => p.id));
  return tasks.filter((t) => !t.completedAt && !(t.projectId && archived.has(t.projectId)));
}

/** The Today page's set: open tasks due today or earlier, overdue first, then by time, then priority. */
export function todayTasks(tasks: readonly Task[], projects: HomeInput["projects"], today: string): Task[] {
  return liveTasks(tasks, projects)
    .filter((t) => t.dueDate != null && t.dueDate <= today)
    .sort(compareTasks);
}

/** Open tasks due tomorrow through the next `UPCOMING_DAYS` days, by date, then time, then priority. */
export function upcomingTasks(tasks: readonly Task[], projects: HomeInput["projects"], today: string): Task[] {
  const last = addDays(today, UPCOMING_DAYS);
  return liveTasks(tasks, projects)
    .filter((t) => t.dueDate != null && t.dueDate > today && t.dueDate <= last)
    .sort(compareTasks);
}

/** Open issues assigned to the viewer: the sidebar's My issues count. */
export function myOpenIssues(issues: readonly ClientIssue[], viewer: string): ClientIssue[] {
  const me = viewer.toLowerCase();
  return issues.filter((i) => i.state === "open" && i.assignees.some((a) => a.toLowerCase() === me));
}

/** The sprint page's URL showing only the viewer's open issues ("View all" of the This sprint tab). */
export function mySprintHref(releaseId: string): string {
  const state: ExplorerState = { ...PRESETS.release, groupBy: "sprintState", filters: [ME, OPEN] };
  return `/releases/${releaseId}?s=${encodeState(state)}`;
}

/** The meta on the viewer's day: `today` and the date-resolved sprints follow the `today` given. */
function metaOn(meta: ClientMeta, today: string): ClientMeta {
  return meta.today === today ? meta : { ...meta, today, ...releasesOn(meta.releases, today) };
}

/**
 * The sprint's counted issues (remaining and done) per Status option in project
 * order, then those without a Status. Not planned is left out, as in the
 * percentage (§4.5), so the parts add up to "Y" of "X / Y done".
 */
export function sprintSegments(issues: readonly ClientIssue[], meta: Pick<ClientMeta, "fields" | "mapping">): SprintSegment[] {
  const doneIds = new Set(meta.mapping.doneStatusIds);
  const counts = new Map<string | null, number>();
  for (const i of issues) {
    if (sprintBucket(i, doneIds) === "notPlanned") continue;
    counts.set(i.statusId, (counts.get(i.statusId) ?? 0) + 1);
  }
  return [
    ...meta.fields.status.filter((o) => counts.has(o.id)).map((o) => ({ key: o.id, name: plainName(o.name) || o.name, color: o.color, n: counts.get(o.id)! })),
    ...(counts.has(null) ? [{ key: "none", name: "No status", color: null, n: counts.get(null)! }] : []),
  ];
}

function sprintPanel(input: HomeInput, meta: ClientMeta, current: ClientRelease, scoped: ClientIssue[], all: ClientIssue[]): Extract<HomeSprint, { kind: "current" }> {
  const { scope, scopeAdded } = input;
  const risk = releaseRisk({ issues: scoped, release: current, meta, scopeAddedIds: scopeAdded?.ids ?? [] });
  const byIssue = new Map<string, HomeRisk>();
  const flag = (issue: ClientIssue, rule: RiskRule) => {
    const row = byIssue.get(issue.nodeId) ?? { issue, rules: [] };
    row.rules.push(rule);
    byIssue.set(issue.nodeId, row);
  };
  for (const i of risk.noOwner) flag(i, "noOwner");
  for (const i of risk.scopeAdded) flag(i, "scopeAdded");
  const risks = [...byIssue.values()];
  return {
    kind: "current",
    release: current,
    daysLeft: sprintTiming(current, meta.today).daysLeft ?? 0,
    stats: sprintStats(scoped, meta),
    segments: sprintSegments(scoped, meta),
    added: scopeAdded?.loaded ? risk.scopeAdded.length : null,
    risks: risks.slice(0, RISK_ROWS),
    riskCount: risks.length,
    scopeLabel: scope ? `${plainName(scope.name) || scope.name} · ${scoped.length} / ${all.length}` : null,
    href: `/releases/${current.id}`,
  };
}

/** Status option order of the project (no Status last), then Priority, highest first. */
function byStatusThenPriority(a: ClientIssue, b: ClientIssue): number {
  const rank = (r: number | null) => r ?? Number.MAX_SAFE_INTEGER;
  if (rank(a.statusRank) !== rank(b.statusRank)) return rank(a.statusRank) - rank(b.statusRank);
  if ((b.priorityRank ?? -1) !== (a.priorityRank ?? -1)) return (b.priorityRank ?? -1) - (a.priorityRank ?? -1);
  return a.number - b.number;
}

function tab<R>(rows: R[]): { rows: R[]; count: number; more: boolean } {
  return { rows: rows.slice(0, TAB_ROWS), count: rows.length, more: rows.length > TAB_ROWS };
}

function attention(needs: ClientIssue[], data: ClientData, meta: ClientMeta): HomeAttention[] {
  const out: HomeAttention[] = needs.slice(0, TRIAGE_NEW_ROWS).map((issue) => ({ issue, reason: "triage", text: "New in triage" }));
  const seen = new Set(out.map((r) => r.issue.nodeId));
  // The longest-quiet first: the existing `older_than_days` filter on `updated`.
  const quiet = runExplorer(data.issues, [OPEN, ME, { field: "updated", op: "older_than_days", days: QUIET_DAYS }], [{ field: "updated", dir: "asc" }], meta);
  for (const issue of quiet) {
    if (out.length >= ATTENTION_ROWS) break;
    if (seen.has(issue.nodeId)) continue;
    const since = Math.floor((Date.parse(`${meta.today}T00:00:00Z`) - Date.parse(issue.updatedAt)) / 86_400_000);
    out.push({ issue, reason: "quiet", text: `Quiet for ${days(Math.max(since, QUIET_DAYS))}` });
  }
  return out;
}

function watchedChanges(watch: NonNullable<HomeInput["watch"]>, meta: ClientMeta): NonNullable<HomeModel["changes"]> {
  const rows: HomeChange[] = [];
  // An issue watched directly and through a view reports the same change twice.
  const seen = new Set<string>();
  const watchKeys: string[] = [];
  for (const [watchKey, list] of Object.entries(watch.changes)) {
    if (list.length) watchKeys.push(watchKey);
    for (const c of list) {
      if (!isShownChange(meta, c)) continue;
      const id = `${c.issueNodeId}:${c.field}:${c.observedAt}`;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ watchKey, issueNodeId: c.issueNodeId, observedAt: c.observedAt, source: c.source, line: describeFieldChange(meta, c) });
    }
  }
  rows.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return { rows: rows.slice(0, CHANGE_ROWS), total: rows.length, watchKeys };
}

/** Open current-sprint issues with sub-issues, lowest progress first; those whose progress is not loaded go last. */
export function sprintEpics(issues: readonly ClientIssue[]): HomeEpic[] {
  const out: HomeEpic[] = [];
  for (const issue of issues) {
    if (issue.state !== "open") continue;
    const progress = subProgress(issue);
    if (progress.kind !== "none") out.push({ issue, progress });
  }
  const key = (e: HomeEpic) => progressKey(e.issue) ?? Number.POSITIVE_INFINITY;
  return out.sort((a, b) => key(a) - key(b) || a.issue.number - b.issue.number).slice(0, EPIC_ROWS);
}

export function homeModel(input: HomeInput): HomeModel {
  const { data, tasks, projects, today, scope, tasksOnly } = input;
  const due = todayTasks(tasks, projects, today);
  const overdue = due.filter((t) => t.dueDate! < today).length;
  const upcoming = upcomingTasks(tasks, projects, today);

  const tiles: HomeTile[] = [
    {
      id: "due",
      label: "Tasks due today",
      // The sidebar's Today count and the Dock badge: the one definition.
      value: String(dueCount(tasks, projects, today)),
      sub: overdue ? `${overdue} overdue` : "Nothing overdue",
      critical: overdue > 0,
      href: "/tasks/today",
    },
  ];
  const todayTab: HomeTab = { id: "today", kind: "tasks", label: "Today", ...tab(due), href: "/tasks/today", empty: "Nothing due today" };
  const upcomingTab: HomeTab = { id: "upcoming", kind: "tasks", label: "Upcoming", ...tab(upcoming), href: "/tasks/upcoming", empty: "Nothing due this week" };
  // "3 meetings today", only while calendar reading is on (CALENDAR-SPEC §3.2).
  const meetingLine = input.calendar?.connected ? `${input.calendar.meetings} meeting${input.calendar.meetings === 1 ? "" : "s"} today` : "";

  if (tasksOnly) return { context: meetingLine, tiles, tabs: [todayTab, upcomingTab], sprint: null, attention: null, changes: null, epics: null };

  const meta = metaOn(data.meta, today);
  const onDay: ClientData = meta === data.meta ? data : { ...data, meta };
  const snoozes = input.snoozes ?? new Map<string, string>();
  const sprints = sprintOn(meta);
  const current = sprints ? (meta.releases.find((r) => r.id === meta.currentReleaseId) ?? null) : null;
  const next = sprints ? (meta.releases.find((r) => r.id === meta.nextReleaseId) ?? null) : null;

  const mine = myOpenIssues(data.issues, meta.viewer);
  const queues = triageTabs(meta);
  const needs = queueRows(queues[0]!, onDay, snoozes, scope, queues[0]!.defaults.sort);
  const newThisWeek = queueRows(queues[1]!, onDay, snoozes, scope).length;
  const unseen = input.watch?.unseen ?? 0;

  tiles.push(
    { id: "mine", label: "My open issues", value: String(mine.length), sub: current ? `${mine.filter((i) => i.releaseId === current.id).length} in ${current.title}` : "", href: "/my" },
    { id: "triage", label: "Needs triage", value: String(needs.length), sub: `${newThisWeek} new this week`, href: "/triage" },
    { id: "watching", label: "Watching", value: String(unseen), sub: unseen ? "Unseen changes" : "Nothing new", href: "/watching" },
  );

  const tabs: HomeTab[] = [todayTab];
  let sprint: HomeSprint | null = null;
  let epics: HomeEpic[] | null = null;
  const context: string[] = [];
  if (sprints && current) {
    const all = data.issues.filter((i) => i.releaseId === current.id);
    // The panel follows the default team scope, like the sprint page [Default H-B].
    const scopeFilters = withDefaultScope([], [], scope);
    const scoped = scopeFilters.length ? runExplorer(all, scopeFilters, [], meta) : all;
    const panel = sprintPanel(input, meta, current, scoped, all);
    sprint = panel;
    epics = sprintEpics(scoped);
    tiles.push({
      id: "sprint",
      label: current.title,
      value: panel.stats.pct == null ? "—" : `${panel.stats.pct}%`,
      sub: `${panel.stats.done} / ${panel.stats.counted} done · ${days(panel.daysLeft)} left`,
      href: panel.href,
    });
    // What the linked sprint page lists under "assigned to me, open": the scope applies there too.
    const mineInSprint = runExplorer(scoped, [ME, OPEN], [], meta).sort(byStatusThenPriority);
    tabs.push({ id: "sprint", kind: "issues", label: "This sprint", ...tab(mineInSprint), href: mySprintHref(current.id), empty: `Nothing assigned to you in ${current.title}` });
    context.push(`${current.title} ends in ${days(panel.daysLeft)}`);
  } else if (sprints) {
    sprint = { kind: "none", next };
  }
  tabs.push(upcomingTab);
  if (needs.length) context.push(`${needs.length} issue${needs.length === 1 ? "" : "s"} need${needs.length === 1 ? "s" : ""} triage`);
  if (meetingLine) context.push(meetingLine);

  return {
    context: context.join(" · "),
    tiles,
    tabs,
    sprint,
    attention: attention(needs, onDay, meta),
    changes: watchedChanges(input.watch ?? { unseen: 0, changes: {} }, meta),
    epics,
  };
}
