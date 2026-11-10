// SPEC §4.9, AI4: Ask on PGlite. An issue is sent as in triage plus the
// user's question; a list sends its cached rows (at most 200). Answers are kept
// in `ai_results` per subject (the issue number, or a hash of the list's rows),
// the newest non-dismissed one is shown with its question, provider, model and
// time, a changed issue/list marks it outdated, Dismiss hides it, invalid model
// output is retried once and then errors without storing anything, and nothing
// here writes to GitHub.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { AiTask } from "@/lib/ai/prompt";
import type { FakeClaude } from "./helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-e2e-login": "alice" }) }));

const { getDb } = await import("@/db");
const { fixtureSnapshot } = await import("../fixtures/github");
const { importFull } = await import("@/lib/sync/import");
const { PostgresStore } = await import("@/lib/sync/store-postgres");
const { getStore, invalidateReadCache } = await import("@/lib/store");
const { saveMapping, resetSettingsCache, saveAiSettings, saveAiVerified } = await import("@/lib/settings");
const { GET: issueAskGet, POST: issueAskPost } = await import("@/app/api/issues/[number]/ask/route");
const { GET: listAskGet, POST: listAskPost } = await import("@/app/api/ai/ask/route");
const { POST: outcomePost } = await import("@/app/api/ai/results/[id]/outcome/route");
const { askIssueInput, askListInput } = await import("@/lib/ai/ask-service");
const { ASK_FEATURE, ASK_ISSUE_SUBJECT_KIND, ASK_LIST_SUBJECT_KIND, MAX_ASK_ROWS, askIssueTask, askListTask } = await import("@/lib/ai/ask");
const { jsonSchemaOf } = await import("@/lib/ai/prompt");
const { getJob, idle, resetJobs } = await import("@/lib/ai/runner");
const { DEFAULT_AI_SETTINGS, verifyId } = await import("@/lib/ai/types");
const { claudeOk, fakeClaude } = await import("./helpers");

const json = (url: string, body?: unknown) => new NextRequest(`http://127.0.0.1:3000${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (url: string) => new NextRequest(`http://127.0.0.1:3000${url}`);
const withParams = <T extends object>(params: T) => ({ params: Promise.resolve(params) });

const QUESTION = "What is this about?";

let fake: FakeClaude;

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
  resetSettingsCache();
  resetJobs();
  await getDb().execute(sql`TRUNCATE ai_results`);
  fake = fakeClaude();
  process.env.DESKA_LOGIN_PATH = fake.path;
});

afterEach(async () => {
  delete process.env.DESKA_LOGIN_PATH;
  fake.cleanup();
  await idle().catch(() => undefined);
});

async function configure(): Promise<void> {
  const settings = { ...DEFAULT_AI_SETTINGS, provider: "claude-code" as const };
  await saveAiSettings(settings);
  await saveAiVerified(verifyId(settings));
}

async function finish(jobId: string) {
  await idle();
  return getJob(jobId)!;
}

/** The issue numbers a task's schema allows an answer to name. */
function refEnum(task: AiTask): string[] {
  const schema = jsonSchemaOf(task) as { properties: { references: { items: { enum?: string[] } } } };
  return schema.properties.references.items.enum ?? [];
}

/** A schema-valid answer for an issue, built from the same task the server builds. */
async function issueAnswer(number: number, question: string) {
  const input = (await askIssueInput(number, question))!;
  const task = askIssueTask(input);
  const references = refEnum(task);
  return { answer: `#${references[0]} is "${input.title}".`, references };
}

/** A schema-valid answer for a list, built from the same task the server builds. */
async function listAnswer(numbers: number[], question: string, total: number) {
  const input = (await askListInput(numbers, question, total))!;
  const task = askListTask(input);
  const references = refEnum(task);
  return { answer: `#${references[0]} and #${references[1]} are in progress.`, references };
}

/** Start an issue ask and wait for its job. */
async function askIssue(number: number, question: string) {
  const started = (await (await issueAskPost(json(`/api/issues/${number}/ask`, { question }), withParams({ number: String(number) }))).json()).job;
  return finish(started.id);
}

/** The issue ask view for an issue. */
async function issueView(number: number) {
  return (await (await issueAskGet(get(`/api/issues/${number}/ask`), withParams({ number: String(number) }))).json()) as { answer: Record<string, unknown> | null; ai: { ready: boolean; reason: string | null } };
}

describe("AI off: nothing is sent", () => {
  it("says why AI can't run, and a question returns that reason without spawning the CLI", async () => {
    await saveAiSettings({ ...DEFAULT_AI_SETTINGS, provider: "off" });
    await saveAiVerified(null);

    const view = await issueView(102);
    expect(view).toMatchObject({ answer: null, ai: { ready: false, reason: expect.stringContaining("AI assist is off") } });

    const job = (await (await issueAskPost(json("/api/issues/102/ask", { question: QUESTION }), withParams({ number: "102" }))).json()).job;
    expect(job).toMatchObject({ state: "error", error: { code: "off" }, result: null, resultId: null });
    expect(fake.runs()).toHaveLength(0);
    expect((await getDb().execute(sql`SELECT count(*)::int AS n FROM ai_results`)).rows[0]).toMatchObject({ n: 0 });
  });
});

describe("an answer about an issue", () => {
  it("stores it with its question, provider, model and time", async () => {
    await configure();
    fake.reply(claudeOk(await issueAnswer(102, QUESTION)));

    const started = (await (await issueAskPost(json("/api/issues/102/ask", { question: QUESTION }), withParams({ number: "102" }))).json()).job;
    expect(started).toMatchObject({ feature: ASK_FEATURE, subject: "102", error: null, resultId: null });

    const done = await finish(started.id);
    expect(done).toMatchObject({ state: "done", provider: "claude-code", model: "sonnet", error: null });
    expect(done.resultId).toBeTruthy();

    const view = await issueView(102);
    expect(view.ai).toEqual({ ready: true, reason: null });
    expect(view.answer).toMatchObject({
      id: done.resultId,
      question: QUESTION,
      answer: expect.stringContaining("#102"),
      references: [102],
      provider: "claude-code",
      model: "sonnet",
      fresh: true,
    });
    expect(view.answer!.answerHtml).toContain('href="https://github.com/acme/widgets/issues/102"');
    // createdAt is an ISO timestamp of when the answer was stored.
    expect(new Date(view.answer!.createdAt as string).toISOString()).toBe(view.answer!.createdAt);

    const rows = (await getDb().execute(sql`SELECT feature, subject_kind, subject, input_hash, provider, model, result FROM ai_results`)).rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feature: ASK_FEATURE, subject_kind: ASK_ISSUE_SUBJECT_KIND, subject: "102", provider: "claude-code", model: "sonnet" });
    expect(rows[0]!.result).toMatchObject({ question: QUESTION, answer: expect.stringContaining("#102"), references: ["102"] });
    expect(rows[0]!.input_hash).toMatch(/^[0-9a-f]{64}$/);

    // The model got the question and the issue text as data, with the closed choices in its schema.
    const run = fake.runs()[0]!;
    expect(run.stdin).toContain('<data name="question">');
    expect(run.stdin).toContain(QUESTION);
    expect(run.stdin).toContain("#102 Bug: crash on start");
    expect(run.stdin).toContain("<data name=\"issue\">");
    const schema = JSON.parse(run.args[run.args.indexOf("--json-schema") + 1]!) as { properties: { references: { items: { enum: string[] } } } };
    expect(schema.properties.references.items.enum).toEqual(["102"]);
  });

  it("marks the answer outdated once the issue changes", async () => {
    await configure();
    fake.reply(claudeOk(await issueAnswer(102, QUESTION)));
    await askIssue(102, QUESTION);
    const before = await issueView(102);
    const id = before.answer!.id;
    expect(before.answer).toMatchObject({ question: QUESTION, fresh: true });

    // GitHub changes the issue: the stored answer no longer matches its updated_at.
    await getDb().execute(sql`UPDATE issues SET updated_at = now() + interval '1 minute' WHERE number = 102`);
    invalidateReadCache();
    const after = await issueView(102);
    expect(after.answer).toMatchObject({ id, question: QUESTION, fresh: false });
  });

  it("keeps the newest answer per subject, and the older rows stay", async () => {
    await configure();
    const other = "Who works on this?";
    const newest = "What changed?";
    fake.reply(claudeOk(await issueAnswer(102, QUESTION)), claudeOk(await issueAnswer(100, other)), claudeOk(await issueAnswer(102, newest)));

    await askIssue(102, QUESTION);
    await askIssue(100, other);
    // A second subject gets its own row.
    const subjects = (await getDb().execute(sql`SELECT subject, subject_kind FROM ai_results ORDER BY subject`)).rows as { subject: string; subject_kind: string }[];
    expect(subjects).toEqual([
      { subject: "100", subject_kind: ASK_ISSUE_SUBJECT_KIND },
      { subject: "102", subject_kind: ASK_ISSUE_SUBJECT_KIND },
    ]);
    expect((await issueView(102)).answer).toMatchObject({ question: QUESTION });
    expect((await issueView(100)).answer).toMatchObject({ question: other });

    // Asking a different question about #102 shows the newest answer; the older row is kept.
    await askIssue(102, newest);
    expect((await issueView(102)).answer).toMatchObject({ question: newest });
    const counts = (await getDb().execute(sql`SELECT subject, count(*)::int AS n FROM ai_results GROUP BY subject ORDER BY subject`)).rows as { subject: string; n: number }[];
    expect(counts).toEqual([
      { subject: "100", n: 1 },
      { subject: "102", n: 2 },
    ]);
  });

  it("hides a dismissed answer, and a new question still works", async () => {
    await configure();
    const next = "What changed?";
    fake.reply(claudeOk(await issueAnswer(102, QUESTION)), claudeOk(await issueAnswer(102, next)));
    await askIssue(102, QUESTION);
    const before = await issueView(102);
    const id = before.answer!.id as string;

    const dismissed = await outcomePost(json(`/api/ai/results/${id}/outcome`, { outcome: "dismissed" }), withParams({ id }));
    expect(dismissed.status).toBe(200);
    expect(await dismissed.json()).toEqual({ outcome: "dismissed" });
    expect((await issueView(102)).answer).toBeNull();

    // Dismissing one answer does not stop a new question.
    const after = await askIssue(102, next);
    expect(after).toMatchObject({ state: "done" });
    expect((await issueView(102)).answer).toMatchObject({ question: next });
    expect((await getDb().execute(sql`SELECT count(*)::int AS n FROM ai_results`)).rows[0]).toMatchObject({ n: 2 });
  });
});

describe("invalid model output (§4.9 validated)", () => {
  it("retries once, then reports invalid output and stores nothing", async () => {
    await configure();
    // #9999 is not in the material: the closed choices refuse it.
    fake.reply(claudeOk({ answer: "See #9999.", references: ["9999"] }));

    const started = (await (await issueAskPost(json("/api/issues/102/ask", { question: QUESTION }), withParams({ number: "102" }))).json()).job;
    const done = await finish(started.id);
    expect(done).toMatchObject({ state: "error", error: { code: "invalid-output" }, result: null, resultId: null });
    expect(fake.runs()).toHaveLength(2);
    expect((await getDb().execute(sql`SELECT count(*)::int AS n FROM ai_results`)).rows[0]).toMatchObject({ n: 0 });
    expect((await issueView(102)).answer).toBeNull();
  });

  it("accepts a valid answer on the one retry", async () => {
    await configure();
    const valid = await issueAnswer(102, QUESTION);
    fake.reply(claudeOk({ answer: "See #9999.", references: ["9999"] }), claudeOk(valid));

    const started = (await (await issueAskPost(json("/api/issues/102/ask", { question: QUESTION }), withParams({ number: "102" }))).json()).job;
    const done = await finish(started.id);
    expect(done).toMatchObject({ state: "done", error: null });
    expect(fake.runs()).toHaveLength(2);
    // The retry prompt tells the model why the first answer was not valid.
    expect(fake.runs()[1]!.stdin).toContain("previous answer was not valid");
    expect((await issueView(102)).answer).toMatchObject({ question: QUESTION, references: [102] });
  });
});

describe("an answer about a list", () => {
  it("is stored per list subject and shown for the same list only", async () => {
    await configure();
    const numbers = [100, 101, 102];
    const question = "Which issues are in progress?";
    fake.reply(claudeOk(await listAnswer(numbers, question, numbers.length)));

    const started = (await (await listAskPost(json("/api/ai/ask", { question, numbers, total: numbers.length }))).json()).job;
    expect(started).toMatchObject({ feature: ASK_FEATURE, subject: expect.stringMatching(/^list:/) });
    const done = await finish(started.id);
    expect(done).toMatchObject({ state: "done", provider: "claude-code", model: "sonnet" });

    const view = (await (await listAskGet(get("/api/ai/ask?numbers=100,101,102&total=3"))).json()) as { answer: Record<string, unknown> | null; ai: { ready: boolean; reason: string | null } };
    expect(view.ai).toEqual({ ready: true, reason: null });
    expect(view.answer).toMatchObject({ question, provider: "claude-code", model: "sonnet", fresh: true });
    // The references are the sent rows, as numbers.
    expect(view.answer!.references).toEqual([100, 101, 102]);
    expect((view.answer!.references as number[]).every((n) => numbers.includes(n))).toBe(true);

    const rows = (await getDb().execute(sql`SELECT subject, subject_kind, result FROM ai_results`)).rows as { subject: string; subject_kind: string; result: Record<string, unknown> }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subject).toMatch(/^list:/);
    expect(rows[0]!.subject_kind).toBe(ASK_LIST_SUBJECT_KIND);
    expect(rows[0]!.result).toMatchObject({ question, total: numbers.length, sent: numbers.length });

    // The model got the rows and the question as data.
    const run = fake.runs()[0]!;
    expect(run.stdin).toContain('<data name="list">');
    expect(run.stdin).toContain("The list has 3 issues, all below.");
    expect(run.stdin).toContain('<data name="issues">');
    expect(run.stdin).toContain("#100 Epic: dashboard overhaul");
    expect(run.stdin).toContain(question);
    const schema = JSON.parse(run.args[run.args.indexOf("--json-schema") + 1]!) as { properties: { references: { items: { enum: string[] } } } };
    expect(schema.properties.references.items.enum).toEqual(["100", "101", "102"]);

    // A list with other rows is a different subject: nothing is shown.
    expect((await (await listAskGet(get("/api/ai/ask?numbers=100,101&total=2"))).json()).answer).toBeNull();

    // A changed row marks the same list's answer outdated.
    await getDb().execute(sql`UPDATE issues SET updated_at = now() + interval '1 minute' WHERE number = 101`);
    invalidateReadCache();
    const changed = (await (await listAskGet(get("/api/ai/ask?numbers=100,101,102&total=3"))).json()) as { answer: Record<string, unknown> | null };
    expect(changed.answer).toMatchObject({ id: view.answer!.id, question, fresh: false });
  });
});

describe("what Ask refuses (§4.9 closed choices)", () => {
  it("refuses bad numbers, an empty question, too many numbers and an uncached issue", async () => {
    await configure();

    expect((await listAskGet(get("/api/ai/ask?numbers=abc"))).status).toBe(400);
    expect((await issueAskPost(json("/api/issues/102/ask", { question: "" }), withParams({ number: "102" }))).status).toBe(400);
    expect((await issueAskPost(json("/api/issues/102/ask", {}), withParams({ number: "102" }))).status).toBe(400);
    expect((await listAskPost(json("/api/ai/ask", { question: "", numbers: [100] }))).status).toBe(400);
    const tooMany = Array.from({ length: MAX_ASK_ROWS + 1 }, (_, i) => i + 1);
    expect((await listAskPost(json("/api/ai/ask", { question: "Which?", numbers: tooMany }))).status).toBe(400);
    expect((await listAskPost(json("/api/ai/ask", { question: "Which?", numbers: [0] }))).status).toBe(400);
    expect((await listAskPost(json("/api/ai/ask", { question: "Which?", numbers: [] }))).status).toBe(400);

    // #103 is a pull request: sync never caches it, so it cannot be asked about.
    expect((await issueAskGet(get("/api/issues/103/ask"), withParams({ number: "103" }))).status).toBe(404);
    expect((await issueAskPost(json("/api/issues/103/ask", { question: QUESTION }), withParams({ number: "103" }))).status).toBe(404);
    // A list with no cached row has nothing to ask about.
    const empty = (await (await listAskGet(get("/api/ai/ask?numbers=103"))).json()) as { answer: unknown; ai: { ready: boolean } };
    expect(empty).toMatchObject({ answer: null, ai: { ready: true } });
    const refused = await listAskPost(json("/api/ai/ask", { question: "What?", numbers: [103] }));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain("There is nothing to ask about.");
    expect(fake.runs()).toHaveLength(0);
  });

  it("makes no GitHub write for an issue answer (only the cache is read)", async () => {
    await configure();
    fake.reply(claudeOk(await issueAnswer(102, QUESTION)));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const job = await askIssue(102, QUESTION);
      expect(job.state).toBe("done");
      const github = fetchSpy.mock.calls.filter(([url]) => String(url).includes("github"));
      const writes = github.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") !== "GET");
      expect(writes).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
