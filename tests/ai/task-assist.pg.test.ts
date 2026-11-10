// SPEC §4.9, AI2: task assist on PGlite. A quick-add line is stored in
// `ai_results` (feature "task-assist", subject_kind "task"); Tidy Inbox covers
// only the open top-level Inbox tasks, starts one job per task sharing one batch
// id, and marks a suggestion outdated when its task changes. Accepting a task
// suggestion is a local edit: it answers 200 while writes are off and is not
// offered again; an issue suggestion still goes through the write gate. A stale
// task list asks nothing, a bad clock is refused, and a suggestion never calls
// GitHub.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { FakeClaude } from "./helpers";
import type { CreateTaskInput, Task } from "@/lib/tasks/model";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-e2e-login": "alice" }) }));

const { getDb } = await import("@/db");
const { fixtureSnapshot } = await import("../fixtures/github");
const { importFull } = await import("@/lib/sync/import");
const { PostgresStore } = await import("@/lib/sync/store-postgres");
const { invalidateReadCache } = await import("@/lib/store");
const { resetSettingsCache, saveAiSettings, saveAiVerified } = await import("@/lib/settings");
const { POST: quickAddPost } = await import("@/app/api/ai/task-assist/route");
const { GET: tidyGet, POST: tidyPost } = await import("@/app/api/ai/tidy-inbox/route");
const { POST: outcomePost } = await import("@/app/api/ai/results/[id]/outcome/route");
const { GET: statusGet } = await import("@/app/api/ai/status/route");
const { quickAddInput } = await import("@/lib/ai/task-assist-service");
const { getJob, idle, resetJobs } = await import("@/lib/ai/runner");
const { saveResult } = await import("@/lib/ai/results");
const { inputHash } = await import("@/lib/ai/prompt");
const { taskAssistTask } = await import("@/lib/ai/task-assist");
const { DEFAULT_AI_SETTINGS, verifyId } = await import("@/lib/ai/types");
const { writeEnabled } = await import("@/lib/outbox/queue");
const { LOCAL_OWNER } = await import("@/lib/local-owner");
const { createLabel, createProject, createSection, createTask, updateTask } = await import("@/lib/tasks/service");
const { claudeOk, fakeClaude } = await import("./helpers");

const CLOCK = { today: "2026-11-10", now: "12:00", tz: "Europe/Berlin" };
const json = (url: string, body?: unknown) =>
  new NextRequest(`http://127.0.0.1:3000${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = (url: string) => new NextRequest(`http://127.0.0.1:3000${url}`);
const withParams = <T extends object>(params: T) => ({ params: Promise.resolve(params) });

let fake: FakeClaude;
let projectId: string;
let sectionId: string;

beforeAll(async () => {
  await getDb().execute(
    sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state RESTART IDENTITY CASCADE`,
  );
  await importFull(fixtureSnapshot(), new PostgresStore());
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
    sql`TRUNCATE tasks, task_links, task_projects, task_sections, task_placements, task_labels, task_label_links, task_reminders, task_completions, task_comments, notifications, user_prefs, ai_results RESTART IDENTITY CASCADE`,
  );
  fake = fakeClaude();
  process.env.DESKA_LOGIN_PATH = fake.path;
  // The choices a suggestion may name: one project with a section, and a label.
  projectId = await newProject("Home");
  sectionId = await newSection(projectId, "This week");
  await newLabel("errand");
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

async function newSection(project: string, name: string): Promise<string> {
  const r = await createSection(LOCAL_OWNER, { projectId: project, name });
  if (!r.ok) throw new Error(r.error);
  return r.value.id;
}

async function newLabel(name: string): Promise<string> {
  const r = await createLabel(LOCAL_OWNER, { name, color: "blue" });
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

async function configure(): Promise<void> {
  const settings = { ...DEFAULT_AI_SETTINGS, provider: "claude-code" as const };
  await saveAiSettings(settings);
  await saveAiVerified(verifyId(settings));
}

/** A schema-valid quick-add answer, built from the same input the server builds. */
async function quickAnswer(text: string) {
  const input = await quickAddInput(text, CLOCK);
  const project = input.projects[0]!;
  return {
    title: "Buy oat milk",
    dueDate: "2026-11-12",
    dueTime: "09:00",
    recurrence: null,
    priority: 2,
    reason: "It reads like an errand.",
    projectId: project.id,
    sectionId: project.sections[0]!.id,
    labelIds: [input.labels[0]!.id],
    issueNumber: input.issues[0] ? String(input.issues[0].number) : null,
  };
}

/** A schema-valid Tidy Inbox answer that keeps every value: the tests check the plumbing. */
const TIDY_ANSWER = {
  title: null,
  dueDate: null,
  dueTime: null,
  recurrence: null,
  priority: null,
  reason: "Nothing to tidy.",
  projectId: null,
  sectionId: null,
  labelIds: [] as string[],
  issueNumber: null,
};

describe("AI off: nothing is sent", () => {
  it("returns the reason with the job and never spawns the CLI", async () => {
    await saveAiSettings({ ...DEFAULT_AI_SETTINGS, provider: "off" });
    await saveAiVerified(null);
    expect(await (await statusGet(get("/api/ai/status"))).json()).toMatchObject({ ready: false, reason: expect.stringContaining("AI assist is off") });
    const view = await (await tidyGet(get("/api/ai/tidy-inbox"))).json();
    expect(view).toMatchObject({ tasks: [], total: 0, ai: { ready: false, reason: expect.stringContaining("AI assist is off") } });

    const res = await quickAddPost(json("/api/ai/task-assist", { text: "Buy milk", ...CLOCK }));
    expect(res.status).toBe(200);
    const { job } = await res.json();
    expect(job).toMatchObject({ state: "error", error: { code: "off" }, result: null, resultId: null });
    expect(fake.runs()).toHaveLength(0);
    expect((await getDb().execute(sql`SELECT count(*)::int AS n FROM ai_results`)).rows[0]).toMatchObject({ n: 0 });
  });
});

describe("a quick-add suggestion", () => {
  it("is stored in ai_results and returned with the job", async () => {
    await configure();
    const text = "Fix the crash on start";
    const expected = await quickAnswer(text);
    fake.reply(claudeOk(expected));

    const res = await quickAddPost(json("/api/ai/task-assist", { text, ...CLOCK }));
    expect(res.status).toBe(200);
    const { job } = await res.json();
    expect(job).toMatchObject({ feature: "task-assist", state: "queued" });
    expect(job.subject).toMatch(/^quick-add:[0-9a-f]{8}$/);
    await idle();
    const done = getJob(job.id)!;
    expect(done).toMatchObject({ state: "done", provider: "claude-code", model: "sonnet", result: expected, error: null });
    expect(done.resultId).toBeTruthy();

    const rows = (await getDb().execute(sql`SELECT feature, subject_kind, subject, input_hash, provider, model, result FROM ai_results`)).rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: "task-assist", subject_kind: "task", provider: "claude-code", model: "sonnet", subject: job.subject, result: expected });
    expect(rows[0]!.input_hash).toBe(inputHash(taskAssistTask(await quickAddInput(text, CLOCK)), ""));
    // The line went to the model in a data block, not as instructions.
    expect(fake.runs()[0]!.stdin).toContain('<data name="typed line">');
  });
});

describe("Tidy Inbox", () => {
  it("tidies only the open top-level tasks that are in the Inbox", async () => {
    await configure();
    const first = await newTask("Buy milk");
    const second = await newTask("Book the room");
    await newTask("File this", { projectId, sectionId }); // filed in a project
    await newTask("Sub-task", { parentId: first.id }); // a sub-task
    const completed = await newTask("Done already");
    expect((await updateTask(LOCAL_OWNER, completed.id, { completed: true })).ok).toBe(true);

    const view = await (await tidyGet(get("/api/ai/tidy-inbox"))).json();
    expect(view.ai).toEqual({ ready: true, reason: null });
    expect(view.total).toBe(2);
    expect(view.tasks.map((t: { taskId: string }) => t.taskId).sort()).toEqual([first.id, second.id].sort());
    expect(view.tasks.every((t: { suggestion: unknown }) => t.suggestion === null)).toBe(true);
  });

  it("starts one job per task, shares one batch id, and all finish", async () => {
    await configure();
    const first = await newTask("Buy milk");
    const second = await newTask("Book the room");
    fake.reply(claudeOk(TIDY_ANSWER));

    const res = await tidyPost(json("/api/ai/tidy-inbox", CLOCK));
    expect(res.status).toBe(200);
    const batch = await res.json();
    expect(batch.jobs).toHaveLength(2);
    expect(batch.total).toBe(2);
    expect(batch.jobs.every((j: { batchId: string }) => j.batchId === batch.batchId)).toBe(true);
    await idle();
    expect(batch.jobs.map((j: { id: string }) => getJob(j.id)!.state)).toEqual(["done", "done"]);

    const rows = (await getDb().execute(sql`SELECT subject_kind, subject FROM ai_results WHERE feature = 'task-assist'`)).rows as { subject_kind: string; subject: string }[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.subject).sort()).toEqual([first.id, second.id].sort());
    expect(rows.every((r) => r.subject_kind === "task")).toBe(true);
  });

  it("shows each task with its fresh suggestion, and marks one outdated when the task changes", async () => {
    await configure();
    const first = await newTask("Buy milk");
    const second = await newTask("Book the room");
    fake.reply(claudeOk(TIDY_ANSWER));
    await (await tidyPost(json("/api/ai/tidy-inbox", CLOCK))).json();
    await idle();

    let view = await (await tidyGet(get("/api/ai/tidy-inbox"))).json();
    expect(view.tasks).toHaveLength(2);
    for (const t of view.tasks) {
      expect(t.suggestion).toMatchObject({ provider: "claude-code", model: "sonnet", fresh: true, acceptedAt: null, dismissedAt: null });
      expect(t.suggestion.result).toEqual(TIDY_ANSWER);
      expect(t.suggestion.id).toBeTruthy();
    }

    // The task changed after the suggestion: "Outdated · Run again".
    await getDb().execute(sql`UPDATE tasks SET updated_at = now() + interval '1 minute' WHERE id = ${first.id}`);
    view = await (await tidyGet(get("/api/ai/tidy-inbox"))).json();
    expect(view.tasks.find((t: { taskId: string }) => t.taskId === first.id).suggestion).toMatchObject({ fresh: false });
    expect(view.tasks.find((t: { taskId: string }) => t.taskId === second.id).suggestion).toMatchObject({ fresh: true });
  });

  it("accepts a task suggestion while writes are off, and does not offer it again", async () => {
    await configure();
    expect(writeEnabled()).toBe(false);
    const task = await newTask("Buy milk");
    fake.reply(claudeOk(TIDY_ANSWER));
    await (await tidyPost(json("/api/ai/tidy-inbox", CLOCK))).json();
    await idle();

    const view = await (await tidyGet(get("/api/ai/tidy-inbox"))).json();
    const id = view.tasks[0].suggestion.id as string;
    const res = await outcomePost(json(`/api/ai/results/${id}/outcome`, { outcome: "accepted" }), withParams({ id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "accepted" });

    const after = await (await tidyGet(get("/api/ai/tidy-inbox"))).json();
    expect(after.tasks.find((t: { taskId: string }) => t.taskId === task.id).suggestion).toBeNull();
    expect((await getDb().execute(sql`SELECT accepted_at FROM ai_results WHERE id = ${id}`)).rows[0]).toMatchObject({ accepted_at: expect.anything() });
  });

  it("does not offer a dismissed suggestion again", async () => {
    await configure();
    const task = await newTask("Buy milk");
    fake.reply(claudeOk(TIDY_ANSWER));
    await (await tidyPost(json("/api/ai/tidy-inbox", CLOCK))).json();
    await idle();

    const view = await (await tidyGet(get("/api/ai/tidy-inbox"))).json();
    const id = view.tasks[0].suggestion.id as string;
    expect((await outcomePost(json(`/api/ai/results/${id}/outcome`, { outcome: "dismissed" }), withParams({ id }))).status).toBe(200);
    const after = await (await tidyGet(get("/api/ai/tidy-inbox"))).json();
    expect(after.tasks.find((t: { taskId: string }) => t.taskId === task.id).suggestion).toBeNull();
  });

  it("still refuses to accept an issue suggestion while writes are off", async () => {
    expect(writeEnabled()).toBe(false);
    const id = await saveResult({
      feature: "issue-triage",
      subjectKind: "issue",
      subject: "102",
      inputHash: "hash",
      provider: "claude-code",
      model: "sonnet",
      result: { summary: "A suggestion for #102." },
      durationMs: 1,
      costUsd: null,
    });
    expect(id).toBeTruthy();
    const res = await outcomePost(json(`/api/ai/results/${id}/outcome`, { outcome: "accepted" }), withParams({ id: id! }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Editing is off for this deployment/);
    expect((await getDb().execute(sql`SELECT accepted_at FROM ai_results WHERE id = ${id}`)).rows[0]).toMatchObject({ accepted_at: null });
  });

  it("reruns only the tasks it is given", async () => {
    await configure();
    const first = await newTask("Buy milk");
    const second = await newTask("Book the room");
    fake.reply(claudeOk(TIDY_ANSWER));
    await (await tidyPost(json("/api/ai/tidy-inbox", CLOCK))).json();
    await idle();

    const res = await tidyPost(json("/api/ai/tidy-inbox", { ...CLOCK, taskIds: [first.id] }));
    expect(res.status).toBe(200);
    const batch = await res.json();
    expect(batch.jobs).toHaveLength(1);
    expect(batch.total).toBe(2);
    expect(batch.jobs[0].subject).toBe(first.id);
    await idle();
    expect(getJob(batch.jobs[0].id)!.state).toBe("done");

    const counts = (await getDb().execute(sql`SELECT subject, count(*)::int AS n FROM ai_results WHERE feature = 'task-assist' GROUP BY subject`)).rows as { subject: string; n: number }[];
    expect(counts.find((c) => c.subject === first.id)?.n).toBe(2);
    expect(counts.find((c) => c.subject === second.id)?.n).toBe(1);
  });

  it("refuses a bad clock and a task that is not in the Inbox", async () => {
    await configure();
    const filed = await newTask("File this", { projectId, sectionId });

    expect((await quickAddPost(json("/api/ai/task-assist", { text: "Buy milk", ...CLOCK, today: "2026-02-30" }))).status).toBe(400);
    expect((await quickAddPost(json("/api/ai/task-assist", { text: "Buy milk", ...CLOCK, tz: "Mars/Olympus" }))).status).toBe(400);
    expect((await tidyPost(json("/api/ai/tidy-inbox", { ...CLOCK, now: "24:00" }))).status).toBe(400);
    expect((await tidyPost(json("/api/ai/tidy-inbox", { ...CLOCK, taskIds: ["not-a-uuid"] }))).status).toBe(400);
    expect((await tidyPost(json("/api/ai/tidy-inbox", { ...CLOCK, taskIds: [filed.id] }))).status).toBe(400);
    expect((await tidyPost(json("/api/ai/tidy-inbox", { ...CLOCK, taskIds: ["00000000-0000-4000-8000-000000000000"] }))).status).toBe(400);
    expect(fake.runs()).toHaveLength(0);
  });

  it("makes no GitHub request for a suggestion (only the cache and the task store are read)", async () => {
    await configure();
    const text = "Fix the crash on start";
    fake.reply(claudeOk(await quickAnswer(text)));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await (await quickAddPost(json("/api/ai/task-assist", { text, ...CLOCK }))).json();
      await idle();
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("api.github.com"))).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
