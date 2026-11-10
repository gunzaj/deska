// SPEC §4.9, AI3: "Plan my day" on PGlite. The plan is built from the open
// tasks that are overdue, due within 7 days or in the Inbox and the user's open
// issues in the current sprint; it is stored in `ai_results` (subject_kind "day"),
// an item naming a task or issue that is not a candidate is dropped, a changed
// candidate marks the plan outdated, a snoozed issue is not planned before its
// date, Dismiss hides it and Accept is a local outcome (no GitHub write).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { FakeClaude } from "./helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-e2e-login": "alice" }) }));

const { getDb } = await import("@/db");
const { fixtureSnapshot } = await import("../fixtures/github");
const { importFull } = await import("@/lib/sync/import");
const { PostgresStore } = await import("@/lib/sync/store-postgres");
const { getStore, invalidateReadCache } = await import("@/lib/store");
const { saveMapping, resetSettingsCache, saveAiSettings, saveAiVerified } = await import("@/lib/settings");
const { GET: planGet, POST: planPost } = await import("@/app/api/ai/plan-my-day/route");
const { POST: outcomePost } = await import("@/app/api/ai/results/[id]/outcome/route");
const { GET: statusGet } = await import("@/app/api/ai/status/route");
const { planMyDayInput } = await import("@/lib/ai/plan-my-day-service");
const { MAX_PLAN_TASKS, PLAN_FEATURE, PLAN_SUBJECT_KIND } = await import("@/lib/ai/plan-my-day");
const { getJob, idle, resetJobs } = await import("@/lib/ai/runner");
const { saveResult } = await import("@/lib/ai/results");
const { DEFAULT_AI_SETTINGS, verifyId } = await import("@/lib/ai/types");
const { writeGate } = await import("@/lib/writes/gate");
const { LOCAL_OWNER } = await import("@/lib/local-owner");
const { addDays, localToday } = await import("@/lib/tasks/dates");
const { createProject, createTask, updateTask } = await import("@/lib/tasks/service");
const { setSnooze } = await import("@/lib/triage/snoozes");
const { claudeOk, fakeClaude } = await import("./helpers");
import type { CreateTaskInput, Task } from "@/lib/tasks/model";
import type { PlanMyDaySuggestion } from "@/lib/ai/plan-my-day";

/** Today where the fixture sprints say the current one is: the real clock. */
const TODAY = localToday(new Date(), "Europe/Berlin");
const CLOCK = { today: TODAY, now: "12:00", tz: "Europe/Berlin" };

const json = (url: string, body?: unknown) => new NextRequest(`http://127.0.0.1:3000${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (url: string) => new NextRequest(`http://127.0.0.1:3000${url}`);
const withParams = <T extends object>(params: T) => ({ params: Promise.resolve(params) });

let fake: FakeClaude;
let projectId: string;

beforeAll(async () => {
  await getDb().execute(
    sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state RESTART IDENTITY CASCADE`,
  );
  await importFull(fixtureSnapshot(), new PostgresStore());
  invalidateReadCache();
  const store = await getStore();
  await saveMapping(store.projectFieldMap());
  invalidateReadCache();
});

beforeEach(async () => {
  process.env.E2E_AUTH_BYPASS = "1";
  process.env.E2E_BYPASS_ACK = "i-understand";
  delete process.env.WRITE_MODE;
  delete process.env.DESKA_WRITES;
  resetSettingsCache();
  resetJobs();
  await getDb().execute(
    sql`TRUNCATE tasks, task_links, task_projects, task_sections, task_placements, task_labels, task_label_links, task_reminders, task_completions, task_comments, notifications, user_prefs, triage_snoozes, ai_results RESTART IDENTITY CASCADE`,
  );
  fake = fakeClaude();
  process.env.DESKA_LOGIN_PATH = fake.path;
  projectId = await newProject("Home");
});

afterEach(async () => {
  delete process.env.DESKA_LOGIN_PATH;
  fake.cleanup();
  await idle().catch(() => undefined);
});

async function newProject(name: string): Promise<string> {
  const r = await createProject(LOCAL_OWNER, { name, color: "grey" });
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

const TASK: CreateTaskInput = {
  title: "",
  description: "",
  priority: 4,
  dueDate: null,
  dueTime: null,
  recurrence: null,
  reminders: [],
  links: [],
  parentId: null,
  projectId: null,
  sectionId: null,
  labels: [],
};

async function newTask(title: string, over: Partial<CreateTaskInput> = {}): Promise<Task> {
  const r = await createTask(LOCAL_OWNER, { ...TASK, title, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** The candidates a plan is built from: one overdue task, one Inbox task, one due soon, one sub-task. */
async function candidates(): Promise<{ overdue: Task; inbox: Task; soon: Task; subtask: Task }> {
  const inbox = await newTask("Buy milk");
  const overdue = await newTask("Fix the crash on start", { dueDate: addDays(TODAY, -1), priority: 1 });
  const soon = await newTask("Write the spec", { dueDate: addDays(TODAY, 3), projectId });
  const subtask = await newTask("Reply to the review", { dueDate: addDays(TODAY, -2), parentId: inbox.id });
  // Not candidates: due too far out, completed, a sub-task without a date.
  await newTask("Next month's plan", { dueDate: addDays(TODAY, 20), projectId });
  const done = await newTask("Done already", { dueDate: addDays(TODAY, -1) });
  expect((await updateTask(LOCAL_OWNER, done.id, { completed: true })).ok).toBe(true);
  await newTask("A sub-task", { parentId: inbox.id });
  return { overdue, inbox, soon, subtask };
}

async function configure(): Promise<void> {
  const settings = { ...DEFAULT_AI_SETTINGS, provider: "claude-code" as const };
  await saveAiSettings(settings);
  await saveAiVerified(verifyId(settings));
}

/** A schema-valid plan, built from the same input the server builds. */
async function answer(over: Partial<PlanMyDaySuggestion> = {}): Promise<PlanMyDaySuggestion> {
  const input = await planMyDayInput("alice", CLOCK);
  const overdue = input.tasks.find((t) => t.dueDate != null && t.dueDate < input.today)!;
  const issue = input.issues[0]!;
  return {
    summary: "One fix first, then the sprint.",
    items: [
      { kind: "task", id: overdue.id, reason: "It is overdue and important.", dueDate: input.today, dueTime: null },
      { kind: "issue", id: String(issue.number), reason: "It is in this sprint.", dueDate: null, dueTime: null },
    ],
    ...over,
  };
}

/** Store a plan row directly, as a previous run would have: the GET checks it against the candidates. */
async function storePlan(plan: PlanMyDaySuggestion): Promise<string | null> {
  return saveResult({
    feature: PLAN_FEATURE,
    subjectKind: PLAN_SUBJECT_KIND,
    subject: TODAY,
    inputHash: "stale",
    provider: "claude-code",
    model: "sonnet",
    result: plan,
    durationMs: 1,
    costUsd: null,
  });
}

async function finish(jobId: string) {
  await idle();
  return getJob(jobId)!;
}

describe("AI off: nothing is sent", () => {
  it("says why AI can't run, and a run returns that reason without spawning the CLI", async () => {
    await candidates();
    await saveAiSettings({ ...DEFAULT_AI_SETTINGS, provider: "off" });
    await saveAiVerified(null);
    expect(await (await statusGet(get("/api/ai/status"))).json()).toMatchObject({ ready: false, reason: expect.stringContaining("AI assist is off") });
    const view = await (await planGet(get(`/api/ai/plan-my-day?today=${TODAY}`))).json();
    expect(view).toMatchObject({ plan: null, ai: { ready: false, reason: expect.stringContaining("AI assist is off") } });
    const job = (await (await planPost(json("/api/ai/plan-my-day", CLOCK))).json()).job;
    expect(job).toMatchObject({ state: "error", error: { code: "off" }, result: null, resultId: null });
    expect(fake.runs()).toHaveLength(0);
    expect((await getDb().execute(sql`SELECT count(*)::int AS n FROM ai_results`)).rows[0]).toMatchObject({ n: 0 });
  });
});

describe("the candidates (SPEC §4.9 Plan my day input)", () => {
  it("takes the overdue tasks, the tasks due within 7 days and the Inbox tasks, and no others", async () => {
    const { overdue, inbox, soon, subtask } = await candidates();
    const input = await planMyDayInput("alice", CLOCK);
    expect(input.tasks.map((t) => t.id).sort()).toEqual([overdue.id, inbox.id, soon.id, subtask.id].sort());
    expect(input.tasks.find((t) => t.id === soon.id)).toMatchObject({ project: "Home", dueDate: addDays(TODAY, 3) });
    expect(input.tasks.find((t) => t.id === inbox.id)).toMatchObject({ project: null, dueDate: null });
  });

  it("takes only the viewer's open issues in the current sprint", async () => {
    const input = await planMyDayInput("alice", CLOCK);
    // #100 is assigned to alice and in the current fixture sprint; #102 is bob's and not in a sprint.
    expect(input.issues.map((i) => i.number)).toEqual([100]);
    expect(input.issues[0]).toMatchObject({ title: "Epic: dashboard overhaul", state: "open", snoozedUntil: null });
  });

  it("carries a triage snooze on its issue", async () => {
    const until = addDays(TODAY, 3);
    await setSnooze("alice", "I_epic", until);
    const input = await planMyDayInput("alice", CLOCK);
    expect(input.issues[0]).toMatchObject({ number: 100, snoozedUntil: until });
  });

  it(`caps the tasks at ${MAX_PLAN_TASKS}`, async () => {
    for (let i = 0; i < MAX_PLAN_TASKS + 2; i++) await newTask(`Task ${i}`, { dueDate: TODAY });
    const input = await planMyDayInput("alice", CLOCK);
    expect(input.tasks).toHaveLength(MAX_PLAN_TASKS);
  });
});

describe("a stored plan", () => {
  it("is stored in ai_results and shown with its candidates and provider", async () => {
    await candidates();
    await configure();
    fake.reply(claudeOk(await answer()));
    const started = (await (await planPost(json("/api/ai/plan-my-day", CLOCK))).json()).job;
    expect(started).toMatchObject({ feature: PLAN_FEATURE, subject: TODAY });
    const done = await finish(started.id);
    expect(done).toMatchObject({ state: "done", provider: "claude-code", model: "sonnet", error: null });
    expect(done.resultId).toBeTruthy();

    const view = await (await planGet(get(`/api/ai/plan-my-day?today=${TODAY}`))).json();
    expect(view.plan).toMatchObject({
      id: done.resultId,
      provider: "claude-code",
      model: "sonnet",
      fresh: true,
      acceptedAt: null,
      dismissedAt: null,
      result: { summary: "One fix first, then the sprint." },
    });
    const input = await planMyDayInput("alice", CLOCK);
    const planned = input.tasks.find((t) => t.dueDate != null && t.dueDate < input.today)!;
    expect(view.plan.result.items.map((i: { kind: string; id: string }) => `${i.kind}:${i.id}`)).toEqual([`task:${planned.id}`, "issue:100"]);
    expect(view.candidates).toEqual({ tasks: 4, issues: 1 });
    expect(view.ai).toEqual({ ready: true, reason: null });

    const rows = (await getDb().execute(sql`SELECT feature, subject_kind, subject, input_hash, provider, model FROM ai_results`)).rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: PLAN_FEATURE, subject_kind: PLAN_SUBJECT_KIND, subject: TODAY, provider: "claude-code", model: "sonnet" });

    // The plan went to the model as data: task IDs, issue numbers and snooze dates.
    const stdin = fake.runs()[0]!.stdin;
    expect(stdin).toContain(`<data name="tasks">`);
    expect(stdin).toContain(planned.id);
    expect(stdin).toContain("#100 Epic: dashboard overhaul");
    expect(stdin).not.toContain("Next month's plan");
  });

  it("marks the plan outdated once a candidate changes", async () => {
    const { overdue } = await candidates();
    await configure();
    fake.reply(claudeOk(await answer()));
    const started = (await (await planPost(json("/api/ai/plan-my-day", CLOCK))).json()).job;
    await finish(started.id);
    expect((await (await planGet(get(`/api/ai/plan-my-day?today=${TODAY}`))).json()).plan).toMatchObject({ fresh: true });

    // The task changes after the plan: "Outdated · Run again".
    await getDb().execute(sql`UPDATE tasks SET updated_at = now() + interval '1 minute' WHERE id = ${overdue.id}`);
    const changed = await (await planGet(get(`/api/ai/plan-my-day?today=${TODAY}`))).json();
    expect(changed.plan).toMatchObject({ fresh: false });
  });

  it("drops an item naming a task or issue that is not a candidate, and a snoozed issue", async () => {
    const { overdue } = await candidates();
    // #100 is snoozed: it must not be planned before its date.
    const until = addDays(TODAY, 3);
    await setSnooze("alice", "I_epic", until);
    const input = await planMyDayInput("alice", CLOCK);
    await storePlan({
      summary: "Keep one.",
      items: [
        { kind: "task", id: overdue.id, reason: "Keep this.", dueDate: TODAY, dueTime: null },
        { kind: "task", id: "99999999-9999-4999-8999-999999999999", reason: "Unknown task.", dueDate: null, dueTime: null },
        { kind: "issue", id: "9999", reason: "Unknown issue.", dueDate: null, dueTime: null },
        { kind: "issue", id: "100", reason: "Snoozed.", dueDate: null, dueTime: null },
      ],
    });
    expect(input.issues[0]).toMatchObject({ number: 100, snoozedUntil: until });

    const view = await (await planGet(get(`/api/ai/plan-my-day?today=${TODAY}`))).json();
    expect(view.plan.result.items.map((i: { kind: string; id: string }) => `${i.kind}:${i.id}`)).toEqual([`task:${overdue.id}`]);

    // Once the snooze is over, the same issue may be planned again.
    await setSnooze("alice", "I_epic", TODAY);
    await storePlan({
      summary: "Keep one.",
      items: [
        { kind: "task", id: overdue.id, reason: "Keep this.", dueDate: TODAY, dueTime: null },
        { kind: "issue", id: "100", reason: "In this sprint.", dueDate: null, dueTime: null },
      ],
    });
    const after = await (await planGet(get(`/api/ai/plan-my-day?today=${TODAY}`))).json();
    expect(after.plan.result.items.map((i: { kind: string }) => i.kind)).toEqual(["task", "issue"]);
  });

  it("keeps a plan that names only an item that no longer exists as an empty plan", async () => {
    const { overdue } = await candidates();
    await storePlan({
      summary: "One fix, then the sprint.",
      items: [
        { kind: "task", id: overdue.id, reason: "It is overdue.", dueDate: TODAY, dueTime: null },
        { kind: "issue", id: "100", reason: "In this sprint.", dueDate: null, dueTime: null },
      ],
    });

    // The planned task is deleted from the task store afterwards: its item is
    // dropped, never shown with a made-up title; the issue item stays.
    await getDb().execute(sql`UPDATE tasks SET deleted_at = now() WHERE id = ${overdue.id}`);
    const view = await (await planGet(get(`/api/ai/plan-my-day?today=${TODAY}`))).json();
    expect(view.plan.result.items.map((i: { kind: string }) => i.kind)).toEqual(["issue"]);
    expect(view.plan.fresh).toBe(false);
  });
});

describe("accept and dismiss (§4.9 Accept / Edit / Dismiss, local outcomes)", () => {
  it("dismisses a plan for the day and does not show it again", async () => {
    await candidates();
    await configure();
    fake.reply(claudeOk(await answer()));
    const started = (await (await planPost(json("/api/ai/plan-my-day", CLOCK))).json()).job;
    await finish(started.id);
    const view = await (await planGet(get(`/api/ai/plan-my-day?today=${TODAY}`))).json();
    const id = view.plan.id as string;

    const res = await outcomePost(json(`/api/ai/results/${id}/outcome`, { outcome: "dismissed" }), withParams({ id }));
    expect(res.status).toBe(200);
    expect((await (await planGet(get(`/api/ai/plan-my-day?today=${TODAY}`))).json())).toMatchObject({ plan: null });
  });

  it("accepts a plan while writes are off: a day is a local subject, not a GitHub change", async () => {
    await candidates();
    await configure();
    expect((await writeGate()).allowed).toBe(false);
    fake.reply(claudeOk(await answer()));
    const started = (await (await planPost(json("/api/ai/plan-my-day", CLOCK))).json()).job;
    await finish(started.id);
    const view = await (await planGet(get(`/api/ai/plan-my-day?today=${TODAY}`))).json();
    const id = view.plan.id as string;

    const res = await outcomePost(json(`/api/ai/results/${id}/outcome`, { outcome: "accepted" }), withParams({ id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "accepted" });
    const after = await (await planGet(get(`/api/ai/plan-my-day?today=${TODAY}`))).json();
    expect(after.plan).toMatchObject({ id, acceptedAt: expect.anything() });
  });
});

describe("what a plan refuses", () => {
  it("refuses a day with nothing to plan and a bad clock", async () => {
    await configure();
    // Nothing to plan: no local tasks and no candidate issue (the fixture's one is hidden).
    await getDb().execute(sql`UPDATE issues SET deleted = true WHERE number = 100`);
    invalidateReadCache();
    try {
      const empty = await planPost(json("/api/ai/plan-my-day", CLOCK));
      expect(empty.status).toBe(400);
      expect((await empty.json()).error).toMatch(/nothing to plan/i);
    } finally {
      await getDb().execute(sql`UPDATE issues SET deleted = false WHERE number = 100`);
      invalidateReadCache();
    }

    await candidates();
    expect((await planPost(json("/api/ai/plan-my-day", { ...CLOCK, today: "2026-02-30" }))).status).toBe(400);
    expect((await planPost(json("/api/ai/plan-my-day", { ...CLOCK, tz: "Mars/Olympus" }))).status).toBe(400);
    expect((await planPost(json("/api/ai/plan-my-day", { ...CLOCK, now: "24:00" }))).status).toBe(400);
    expect((await planGet(get("/api/ai/plan-my-day?today=2026-02-30"))).status).toBe(400);
    expect(fake.runs()).toHaveLength(0);
  });

  it("makes no GitHub request (only the task store and the cache are read)", async () => {
    await candidates();
    await configure();
    fake.reply(claudeOk(await answer()));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const started = (await (await planPost(json("/api/ai/plan-my-day", CLOCK))).json()).job;
      await finish(started.id);
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("api.github.com"))).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
