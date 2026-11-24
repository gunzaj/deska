// Home (HOME-SPEC §3–§5): every tile equals the count its page shows, the tabs
// hold what their pages hold, and each GitHub part goes away when its data does.
import { describe, expect, it } from "vitest";
import { buildClientData } from "@/lib/client/build";
import { decodeState, runExplorer } from "@/lib/client/explorer";
import {
  ATTENTION_ROWS,
  CHANGE_ROWS,
  EPIC_ROWS,
  greeting,
  homeModel,
  longDate,
  mySprintHref,
  RISK_ROWS,
  sprintSegments,
  TAB_ROWS,
  TRIAGE_NEW_ROWS,
  type HomeInput,
  type HomeModel,
  type HomeSprint,
  type HomeTileId,
} from "@/lib/client/home";
import { hydrate } from "@/lib/client/hydrate";
import { OPEN } from "@/lib/client/presets";
import { sprintStats } from "@/lib/client/sprint";
import { validDefault } from "@/lib/client/team-scope";
import { queueRows, triageTabs } from "@/lib/client/triage-queues";
import type { ClientData, ClientIssue } from "@/lib/client/types";
import type { FieldChange } from "@/lib/sync/changes";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { dueCount } from "@/lib/tasks/counts";
import type { Task } from "@/lib/tasks/model";
import { fixtureSnapshot } from "../fixtures/github";

const NOW = new Date("2026-10-12T10:00:00Z");
const TODAY = "2026-10-12";
const SPRINT = "e0000023"; // Sprint 23: 2 Oct – 29 Oct, current on TODAY
const CORE = "c0000001";
const CHECKOUT = "c0000002";

/** The fixture project (one sprint in progress, a Team dimension) with `extra` issues added. */
async function client(extra: (base: ClientIssue, data: ClientData) => ClientIssue[] = () => []): Promise<ClientData> {
  const store = new MemoryStore();
  await importFull(fixtureSnapshot(NOW), store);
  const data = hydrate(buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: NOW }));
  return { ...data, issues: [...data.issues, ...extra(data.issues.find((i) => i.number === 100)!, data)] };
}

/** An open, triaged issue of alice's in the current sprint and the Core team, unless `over` says otherwise. */
const issue = (base: ClientIssue, n: number, over: Partial<ClientIssue> = {}): ClientIssue => ({
  ...base,
  nodeId: `I_${n}`,
  number: n,
  title: `Issue ${n}`,
  hasSubIssues: false,
  subTotal: null,
  subCompleted: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-10-11T00:00:00Z",
  ...over,
});

let seq = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${++seq}`,
  creator: "local",
  parentId: null,
  sectionId: null,
  title: `Task ${seq}`,
  description: "",
  priority: 4,
  dueDate: null,
  dueTime: null,
  dueTz: null,
  recurrence: null,
  reminders: [],
  completedAt: null,
  completedBy: null,
  links: [],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  projectId: null,
  position: 0,
  labels: [],
  ...over,
});

const model = (data: ClientData, over: Partial<HomeInput> = {}): HomeModel => homeModel({ data, tasks: [], projects: [], today: TODAY, scope: null, tasksOnly: false, ...over });
const tile = (m: HomeModel, id: HomeTileId) => m.tiles.find((t) => t.id === id);
const tabOf = (m: HomeModel, id: string) => m.tabs.find((t) => t.id === id);
const current = (m: HomeModel) => m.sprint as Extract<HomeSprint, { kind: "current" }>;
const change = (over: Partial<FieldChange>): FieldChange => ({ issueNodeId: "I_100", field: "status", oldValue: "a0000001", newValue: "a0000002", observedAt: "2026-10-12T08:00:00Z", source: "sync", ...over }) as FieldChange;

describe("header", () => {
  it("greets by the time of day in the viewer's zone", () => {
    expect([greeting("00:00"), greeting("11:59"), greeting("12:00"), greeting("17:59"), greeting("18:00")]).toEqual(["Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening"]);
    expect(longDate(TODAY)).toBe("Monday 12 October");
  });

  it("says when the sprint ends and how many issues need triage, and leaves out what does not apply", async () => {
    const data = await client();
    // Fixture: #102 has no Priority and no Team, so it needs triage.
    expect(model(data).context).toBe("Sprint 23 ends in 18 days · 1 issue needs triage");
    const triaged = { ...data, issues: data.issues.filter((i) => i.number !== 102) };
    expect(model(triaged).context).toBe("Sprint 23 ends in 18 days");
    expect(model(triaged, { today: "2026-11-15" }).context).toBe("");
  });
});

describe("tiles equal what their page shows", () => {
  it("Tasks due today is the Today count (sidebar and Dock badge), with the overdue ones called out", async () => {
    const tasks = [task({ dueDate: TODAY }), task({ dueDate: "2026-10-10" }), task({ dueDate: "2026-10-13" }), task({ dueDate: TODAY, completedAt: "2026-10-12T09:00:00Z" }), task({ dueDate: TODAY, projectId: "arch" }), task({ dueDate: TODAY, parentId: "t1" })];
    const projects = [{ id: "arch", archived: true }];
    const m = model(await client(), { tasks, projects });
    expect(tile(m, "due")).toMatchObject({ value: String(dueCount(tasks, projects, TODAY)), sub: "1 overdue", critical: true, href: "/tasks/today" });
    expect(tile(m, "due")!.value).toBe("3");
    // The Today tab lists the same tasks the tile counts.
    expect(tabOf(m, "today")!.count).toBe(3);
    expect(tile(model(await client(), { tasks: [task({ dueDate: TODAY })] }), "due")).toMatchObject({ value: "1", sub: "Nothing overdue", critical: false });
  });

  it("My open issues is the My issues list, with those in the current sprint", async () => {
    const data = await client((b) => [issue(b, 201, { releaseId: null }), issue(b, 202, { state: "closed" }), issue(b, 203, { assignees: ["bob"] }), issue(b, 204, { assignees: ["Alice"] })]);
    const m = model(data);
    const page = runExplorer(data.issues, [{ field: "assignee", op: "in", values: ["me"] }, OPEN], [], data.meta);
    expect(tile(m, "mine")).toMatchObject({ value: String(page.length), sub: "2 in Sprint 23", href: "/my" });
    expect(page.map((i) => i.number).sort()).toEqual([100, 201, 204]);
  });

  it("Needs triage is the Needs triage queue, without snoozed issues, with New this week below", async () => {
    const data = await client((b) => [issue(b, 301, { priorityId: null, priorityName: null, priorityRank: null, createdAt: "2026-10-10T00:00:00Z" }), issue(b, 302, { createdAt: "2026-10-11T00:00:00Z" })]);
    const queues = triageTabs(data.meta);
    const snoozes = new Map([["I_301", "2026-10-20"]]);
    const m = model(data);
    expect(tile(m, "triage")).toMatchObject({ value: String(queueRows(queues[0]!, data, new Map(), null).length), sub: `${queueRows(queues[1]!, data, new Map(), null).length} new this week`, href: "/triage" });
    expect(tile(m, "triage")).toMatchObject({ value: "2", sub: "2 new this week" });
    expect(tile(model(data, { snoozes }), "triage")).toMatchObject({ value: "1", sub: "1 new this week" });
  });

  it("Watching is the watchlist's unseen count", async () => {
    const data = await client();
    expect(tile(model(data), "watching")).toMatchObject({ value: "0", sub: "Nothing new", href: "/watching" });
    expect(tile(model(data, { watch: { unseen: 2, changes: {} } }), "watching")).toMatchObject({ value: "2", sub: "Unseen changes" });
  });

  it("the sprint tile is the sprint page's done %, X / Y and days left", async () => {
    const data = await client((b) => [issue(b, 401, { state: "closed", stateReason: "completed" }), issue(b, 402, { state: "closed", stateReason: "not_planned" }), issue(b, 403)]);
    const stats = sprintStats(data.issues.filter((i) => i.releaseId === SPRINT), data.meta);
    expect(tile(model(data), "sprint")).toEqual({ id: "sprint", label: "Sprint 23", value: `${stats.pct}%`, sub: `${stats.done} / ${stats.counted} done · 18 days left`, href: `/releases/${SPRINT}` });
    expect([stats.done, stats.counted, stats.pct]).toEqual([1, 3, 33]);
  });

  it("the sprint tile and panel follow the default team scope, and say so", async () => {
    const data = await client((b, d) => {
      const checkout = { [d.meta.dimensions[0]!.id]: { id: CHECKOUT, name: "Checkout 🛒", rank: 1 } };
      return [issue(b, 501, { dims: checkout }), issue(b, 502, { dims: checkout, state: "closed", stateReason: "completed" }), issue(b, 503, { state: "closed", stateReason: "completed" })];
    });
    const scope = validDefault(CHECKOUT, data.meta);
    const m = model(data, { scope });
    expect(tile(m, "sprint")).toMatchObject({ value: "50%", sub: "1 / 2 done · 18 days left" });
    expect(current(m).scopeLabel).toBe("Checkout · 2 / 4");
    expect(current(m).stats).toMatchObject({ done: 1, counted: 2 });
    // Without a default: everything in the sprint, and no label.
    expect(tile(model(data), "sprint")).toMatchObject({ value: "50%", sub: "2 / 4 done · 18 days left" });
    expect(current(model(data)).scopeLabel).toBeNull();
    // The triage tile is counted the way the Triage page counts with that scope on.
    const core = validDefault(CORE, data.meta);
    expect(tile(model(data, { scope: core }), "triage")!.value).toBe(String(queueRows(triageTabs(data.meta)[0]!, data, new Map(), core).length));
  });
});

describe("My work tabs", () => {
  it("Today: tasks due today or earlier, overdue first, then by time, then priority", async () => {
    const tasks = [
      task({ title: "today p4", dueDate: TODAY }),
      task({ title: "today p1", dueDate: TODAY, priority: 1 }),
      task({ title: "today 09:00", dueDate: TODAY, dueTime: "09:00" }),
      task({ title: "overdue", dueDate: "2026-10-09" }),
      task({ title: "tomorrow", dueDate: "2026-10-13" }),
      task({ title: "no date" }),
    ];
    const tab = tabOf(model(await client(), { tasks }), "today")!;
    expect(tab.rows.map((t) => (t as Task).title)).toEqual(["overdue", "today 09:00", "today p1", "today p4"]);
    expect(tab).toMatchObject({ count: 4, more: false, href: "/tasks/today", empty: "Nothing due today" });
  });

  it("Upcoming: tomorrow through the next 7 days, by date", async () => {
    const tasks = [task({ title: "in 8 days", dueDate: "2026-10-20" }), task({ title: "in 7 days", dueDate: "2026-10-19" }), task({ title: "tomorrow", dueDate: "2026-10-13" }), task({ title: "today", dueDate: TODAY }), task({ title: "done", dueDate: "2026-10-14", completedAt: "2026-10-12T09:00:00Z" })];
    const tab = tabOf(model(await client(), { tasks }), "upcoming")!;
    expect(tab.rows.map((t) => (t as Task).title)).toEqual(["tomorrow", "in 7 days"]);
    expect(tab).toMatchObject({ href: "/tasks/upcoming", empty: "Nothing due this week" });
  });

  it("This sprint: my open issues in the current sprint, by Status order, then Priority", async () => {
    const data = await client((b) => [
      issue(b, 601, { statusId: "a0000002", statusRank: 1, priorityRank: 0 }),
      issue(b, 602, { statusId: "a0000001", statusRank: 0, priorityRank: 0 }),
      issue(b, 603, { statusId: null, statusRank: null }),
      issue(b, 604, { assignees: ["bob"] }),
      issue(b, 605, { state: "closed" }),
      issue(b, 606, { releaseId: "e0000022" }),
    ]);
    const tab = tabOf(model(data), "sprint")!;
    // #100 is To do / High, #602 To do / Low, #601 In progress, #603 has no Status.
    expect(tab.rows.map((i) => (i as ClientIssue).number)).toEqual([100, 602, 601, 603]);
    expect(tab).toMatchObject({ label: "This sprint", empty: "Nothing assigned to you in Sprint 23", href: mySprintHref(SPRINT) });
    // "View all" opens the sprint page filtered to me and open: the same issues.
    const state = decodeState(new URL(tab.href, "http://x").searchParams.get("s")) as { filters: Parameters<typeof runExplorer>[1] };
    const page = runExplorer(data.issues, [{ field: "release", op: "in", values: [SPRINT] }, ...state.filters], [], data.meta);
    expect(page.map((i) => i.number).sort()).toEqual([100, 601, 602, 603]);
  });

  it("shows 8 rows and says there are more", async () => {
    const tasks = Array.from({ length: TAB_ROWS + 3 }, () => task({ dueDate: TODAY }));
    const tab = tabOf(model(await client(), { tasks }), "today")!;
    expect([tab.rows.length, tab.count, tab.more]).toEqual([TAB_ROWS, TAB_ROWS + 3, true]);
  });

  it("empty lists are empty, not missing", async () => {
    const m = model(await client((b) => [issue(b, 100, { nodeId: "x", assignees: [] })].slice(0, 0)));
    expect(m.tabs.map((t) => [t.id, t.count])).toEqual([["today", 0], ["sprint", 1], ["upcoming", 0]]);
  });
});

describe("Current sprint panel", () => {
  it("splits the counted issues by Status option, leaving not planned out", async () => {
    const data = await client((b) => [issue(b, 701, { statusId: "a0000002" }), issue(b, 702, { statusId: "a0000006", state: "closed", stateReason: "completed" }), issue(b, 703, { statusId: null }), issue(b, 704, { state: "closed", stateReason: "not_planned" })]);
    const segments = sprintSegments(data.issues.filter((i) => i.releaseId === SPRINT), data.meta);
    expect(segments.map((s) => [s.name, s.n])).toEqual([["To do", 1], ["In progress", 1], ["Done", 1], ["No status", 1]]);
    const panel = current(model(data));
    expect(panel.segments.reduce((n, s) => n + s.n, 0)).toBe(panel.stats.counted);
    expect(panel).toMatchObject({ kind: "current", daysLeft: 18, href: `/releases/${SPRINT}` });
  });

  it("at risk: the existing rules only, each row naming its rule, capped at 5", async () => {
    const data = await client((b) => [...Array.from({ length: 6 }, (_, n) => issue(b, 800 + n, { assignees: [] })), issue(b, 810)]);
    const m = model(data, { scopeAdded: { ids: ["I_800", "I_810"], loaded: true } });
    const panel = current(m);
    expect(panel.riskCount).toBe(7);
    expect(panel.risks).toHaveLength(RISK_ROWS);
    expect(panel.risks[0]).toMatchObject({ issue: { number: 800 }, rules: ["noOwner", "scopeAdded"] });
    expect(panel.added).toBe(2);
    // Until the scope history has loaded there is no "+N added" to show.
    expect(current(model(data)).added).toBeNull();
  });

  it("no sprint in progress: says so, with the next sprint when there is one", async () => {
    const data = await client();
    expect(model(data, { today: "2026-11-15" }).sprint).toEqual({ kind: "none", next: null });
    const before = model(data, { today: "2026-08-01" });
    expect(before.sprint).toMatchObject({ kind: "none", next: { title: "Sprint 22", startDate: "2026-08-28" } });
    expect(tile(before, "sprint")).toBeUndefined();
    expect(tabOf(before, "sprint")).toBeUndefined();
    expect(before.epics).toBeNull();
    expect(tile(before, "mine")!.sub).toBe("");
  });

  it("no Sprint field mapped: the panel, the tile and the tab are gone", async () => {
    const data = await client();
    const m = model({ ...data, meta: { ...data.meta, mapping: { ...data.meta.mapping, sprint: null } } });
    expect(m.sprint).toBeNull();
    expect(m.tiles.map((t) => t.id)).toEqual(["due", "mine", "triage", "watching"]);
    expect(m.tabs.map((t) => t.id)).toEqual(["today", "upcoming"]);
  });
});

describe("tasks-only mode", () => {
  it("shows only the task parts", async () => {
    const m = model(await client(), { tasksOnly: true, tasks: [task({ dueDate: TODAY })] });
    expect(m.tiles.map((t) => t.id)).toEqual(["due"]);
    expect(m.tabs.map((t) => t.id)).toEqual(["today", "upcoming"]);
    expect(m).toMatchObject({ context: "", sprint: null, attention: null, changes: null, epics: null });
  });
});

describe("What needs me (H2)", () => {
  it("Needs attention: the newest 3 of Needs triage, then my issues quiet for 14 days, 6 rows at most", async () => {
    const untriaged = { priorityId: null, priorityName: null, priorityRank: null, assignees: [] as string[] };
    const data = await client((b) => [
      ...[1, 2, 3, 4].map((n) => issue(b, 900 + n, { ...untriaged, createdAt: `2026-10-0${n}T00:00:00Z` })),
      ...[1, 2, 3, 4].map((n) => issue(b, 910 + n, { updatedAt: `2026-09-0${n}T00:00:00Z` })),
      issue(b, 920, { updatedAt: "2026-09-29T00:00:00Z" }), // 13 days: not quiet yet
      issue(b, 921, { updatedAt: "2026-09-01T00:00:00Z", assignees: ["bob"] }),
    ]);
    const rows = model({ ...data, issues: data.issues.filter((i) => i.number > 102) }).attention!;
    expect(rows).toHaveLength(ATTENTION_ROWS);
    expect(rows.slice(0, TRIAGE_NEW_ROWS).map((r) => [r.issue.number, r.text])).toEqual([[904, "New in triage"], [903, "New in triage"], [902, "New in triage"]]);
    expect(rows.slice(TRIAGE_NEW_ROWS).map((r) => [r.issue.number, r.reason])).toEqual([[911, "quiet"], [912, "quiet"], [913, "quiet"]]);
    expect(rows[3]!.text).toBe("Quiet for 41 days");
  });

  it("What changed: unseen watched changes, newest first, worded as on Watching, 5 at most", async () => {
    const data = await client();
    const changes = {
      "issue:I_100": [change({ observedAt: "2026-10-12T08:00:00Z" }), ...[1, 2, 3, 4, 5].map((h) => change({ field: "priority", oldValue: "b0000001", newValue: "b0000003", observedAt: `2026-10-11T0${h}:00:00Z` }))],
      // The same change again through a watched view, and one of an unmapped field.
      "view:v1": [change({ observedAt: "2026-10-12T08:00:00Z" }), change({ field: "dim:F_unmapped" as FieldChange["field"], observedAt: "2026-10-12T09:00:00Z" })],
      "issue:I_none": [],
    };
    const out = model(data, { watch: { unseen: 2, changes } }).changes!;
    expect(out.rows).toHaveLength(CHANGE_ROWS);
    expect(out.total).toBe(6);
    expect(out.rows[0]).toMatchObject({ watchKey: "issue:I_100", line: { label: "Status", text: "📋 To do → 🚧 In progress" } });
    expect(out.rows[1]!.line).toMatchObject({ label: "Priority", text: "Low → High" });
    // "Mark all seen" covers every watch that has something new.
    expect(out.watchKeys).toEqual(["issue:I_100", "view:v1"]);
    expect(model(data).changes).toEqual({ rows: [], total: 0, watchKeys: [] });
  });

  it("Epics in this sprint: open issues with sub-issues, lowest progress first, 5 at most", async () => {
    const epic = (subTotal: number | null, subCompleted: number | null) => ({ hasSubIssues: true, subTotal, subCompleted });
    const data = await client((b) => [
      issue(b, 1001, epic(4, 2)),
      issue(b, 1002, epic(4, 3)),
      issue(b, 1003, epic(null, null)), // children in the cache, counts not read yet
      issue(b, 1004, epic(0, 0)), // no children: not an epic
      issue(b, 1005, { ...epic(4, 1), state: "closed" }),
      issue(b, 1006, { ...epic(4, 1), releaseId: null }),
      ...[7, 8, 9].map((n) => issue(b, 1000 + n, epic(10, 9))),
    ]);
    const rows = model(data).epics!;
    expect(rows).toHaveLength(EPIC_ROWS);
    // #100 (0/1) first, then 2/4, 3/4, then the 9/10s.
    expect(rows.map((r) => r.issue.number)).toEqual([100, 1001, 1002, 1007, 1008]);
    expect(rows[1]!.progress).toEqual({ kind: "counted", total: 4, done: 2, pct: 50 });
    const few = model({ ...data, issues: data.issues.filter((i) => i.number <= 1003) }).epics!;
    expect(few.map((r) => [r.issue.number, r.progress.kind])).toEqual([[100, "counted"], [1001, "counted"], [1002, "counted"], [1003, "unloaded"]]);
  });
});
