// SPEC §4.9, AI1: issue triage suggestions on PGlite. The task is built from
// the cache, the suggestion is stored in `ai_results`, an issue changed on
// GitHub marks it outdated, Dismiss removes it, Accept is refused while writes
// are off, and a queue batch shares one id, runs one job at a time and cancels.
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
const { GET: issueAiGet, POST: issueAiPost } = await import("@/app/api/issues/[number]/ai/route");
const { POST: queuePost } = await import("@/app/api/ai/triage-queue/route");
const { GET: jobsGet } = await import("@/app/api/ai/jobs/route");
const { POST: cancelPost } = await import("@/app/api/ai/jobs/[id]/cancel/route");
const { POST: outcomePost } = await import("@/app/api/ai/results/[id]/outcome/route");
const { GET: statusGet } = await import("@/app/api/ai/status/route");
const { triageInput } = await import("@/lib/ai/triage-service");
const { getJob, idle, resetJobs } = await import("@/lib/ai/runner");
const { DEFAULT_AI_SETTINGS, verifyId } = await import("@/lib/ai/types");
const { claudeOk, fakeClaude } = await import("./helpers");

const json = (url: string, body?: unknown) => new NextRequest(`http://127.0.0.1:3000${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (url: string) => new NextRequest(`http://127.0.0.1:3000${url}`);
const withParams = <T extends object>(params: T) => ({ params: Promise.resolve(params) });

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

async function configure(provider: "claude-code" = "claude-code") {
  const settings = { ...DEFAULT_AI_SETTINGS, provider };
  await saveAiSettings(settings);
  await saveAiVerified(verifyId(settings));
}

/** A schema-valid answer for the issue, built from the same task the server builds. */
async function answer(number: number) {
  const input = (await triageInput(number))!;
  const one = (c: typeof input.choices.status) => (c ? { id: c.options[0]!.id, reason: "Fits the issue.", confidence: "medium" as const } : null);
  return {
    summary: `Suggestion for #${number}.`,
    status: one(input.choices.status),
    priority: one(input.choices.priority),
    dimension: one(input.choices.dimension),
    sprint: one(input.choices.sprint),
    ...(input.repoLabels.length ? { labels: [{ id: input.repoLabels[0]!.id, reason: "The UI is affected.", confidence: "low" as const }] } : {}),
    duplicateOf: input.candidates.length ? String(input.candidates[0]!.number) : null,
    flags: [],
  };
}

async function finish(jobId: string) {
  await idle();
  return getJob(jobId)!;
}

describe("AI off: nothing is sent", () => {

  it("says why AI can't run, and a run returns that reason without spawning the CLI", async () => {
    expect(await (await statusGet(get("/api/ai/status"))).json()).toMatchObject({ ready: false });
    const view = await (await issueAiGet(get("/api/issues/102/ai"), withParams({ number: "102" }))).json();
    expect(view).toMatchObject({ suggestion: null, ai: { ready: false, reason: expect.stringContaining("AI assist is off") } });
    const job = (await (await issueAiPost(json("/api/issues/102/ai"), withParams({ number: "102" }))).json()).job;
    expect(job).toMatchObject({ state: "error", error: { code: "off" } });
    expect(fake.runs()).toHaveLength(0);
  });
});

describe("suggestions", () => {
  it("stores the suggestion, then shows it as outdated once the issue changes", async () => {
    await configure();
    fake.reply(claudeOk(await answer(102)));
    const started = (await (await issueAiPost(json("/api/issues/102/ai"), withParams({ number: "102" }))).json()).job;
    expect(await finish(started.id)).toMatchObject({ state: "done", provider: "claude-code", model: "sonnet" });

    const view = await (await issueAiGet(get("/api/issues/102/ai"), withParams({ number: "102" }))).json();
    expect(view.suggestion).toMatchObject({ result: { summary: "Suggestion for #102." }, provider: "claude-code", model: "sonnet", fresh: true, dismissedAt: null });
    expect(view.ai).toEqual({ ready: true, reason: null });
    const id = view.suggestion.id as string;
    expect(id).toBeTruthy();

    // GitHub changes the issue: the stored suggestion no longer matches its updated_at.
    await getDb().execute(sql`UPDATE issues SET updated_at = now() + interval '1 minute' WHERE number = 102`);
    invalidateReadCache();
    const changed = await (await issueAiGet(get("/api/issues/102/ai"), withParams({ number: "102" }))).json();
    expect(changed.suggestion).toMatchObject({ id, fresh: false });
  });

  it("Run again, then Dismiss: nothing is shown, not the suggestion from before", async () => {
    await configure();
    fake.reply(claudeOk(await answer(102)));
    for (let i = 0; i < 2; i++) {
      const started = (await (await issueAiPost(json("/api/issues/102/ai"), withParams({ number: "102" }))).json()).job;
      await finish(started.id);
    }
    expect(Number((await getDb().execute(sql`SELECT count(*)::int AS n FROM ai_results`)).rows[0]!.n)).toBe(2);
    const view = await (await issueAiGet(get("/api/issues/102/ai"), withParams({ number: "102" }))).json();
    const id = view.suggestion.id as string;
    await outcomePost(json(`/api/ai/results/${id}/outcome`, { outcome: "dismissed" }), withParams({ id }));
    const after = await (await issueAiGet(get("/api/issues/102/ai"), withParams({ number: "102" }))).json();
    expect(after.suggestion).toBeNull();
  });

  it("an accepted suggestion is not offered again", async () => {
    await configure();
    fake.reply(claudeOk(await answer(102)));
    const started = (await (await issueAiPost(json("/api/issues/102/ai"), withParams({ number: "102" }))).json()).job;
    await finish(started.id);
    const view = await (await issueAiGet(get("/api/issues/102/ai"), withParams({ number: "102" }))).json();
    await (await import("@/lib/ai/results")).markResult(view.suggestion.id, "accepted");
    const after = await (await issueAiGet(get("/api/issues/102/ai"), withParams({ number: "102" }))).json();
    expect(after.suggestion).toBeNull();
  });

  it("Accept is refused for a suggestion made before the issue changed, and for one already accepted", async () => {
    const { saveWriteAccess, saveWrites } = await import("@/lib/settings");
    await configure();
    fake.reply(claudeOk(await answer(102)));
    const started = (await (await issueAiPost(json("/api/issues/102/ai"), withParams({ number: "102" }))).json()).job;
    await finish(started.id);
    const view = await (await issueAiGet(get("/api/issues/102/ai"), withParams({ number: "102" }))).json();
    const id = view.suggestion.id as string;
    process.env.DESKA_WRITES = "on";
    await saveWrites(true);
    await saveWriteAccess({ state: "yes", message: null, checkedAt: new Date().toISOString() });
    try {
      await getDb().execute(sql`UPDATE issues SET updated_at = now() + interval '2 minutes' WHERE number = 102`);
      invalidateReadCache();
      const stale = await outcomePost(json(`/api/ai/results/${id}/outcome`, { outcome: "accepted" }), withParams({ id }));
      expect(stale.status).toBe(409);
      expect((await stale.json()).error).toMatch(/changed since/);

      await (await import("@/lib/ai/results")).markResult(id, "accepted");
      const again = await outcomePost(json(`/api/ai/results/${id}/outcome`, { outcome: "accepted" }), withParams({ id }));
      expect(again.status).toBe(409);
      expect((await again.json()).error).toMatch(/already accepted/);
    } finally {
      delete process.env.DESKA_WRITES;
      await saveWrites(false);
    }
  });

  it("showing a stored suggestion asks GitHub for nothing: \"Outdated\" needs no comments", async () => {
    const { setLocalToken } = await import("@/lib/github/local-token");
    await configure();
    fake.reply(claudeOk(await answer(102)));
    const started = (await (await issueAiPost(json("/api/issues/102/ai"), withParams({ number: "102" }))).json()).job;
    await finish(started.id);
    // With a token, building the full input reads the issue's comments live.
    setLocalToken(["github", "pat", "TRIAGE", "FAKE", "0".repeat(24)].join("_"), "launch");
    const fetched = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in this test"));
    try {
      const view = await (await issueAiGet(get("/api/issues/102/ai"), withParams({ number: "102" }))).json();
      expect(view.suggestion).toMatchObject({ fresh: true });
      expect(fetched).not.toHaveBeenCalled();
    } finally {
      fetched.mockRestore();
      setLocalToken(null, "launch");
    }
  });

  it("Dismiss removes it; Accept is refused while writes are off, with the reason", async () => {
    await configure();
    fake.reply(claudeOk(await answer(102)));
    const started = (await (await issueAiPost(json("/api/issues/102/ai"), withParams({ number: "102" }))).json()).job;
    await finish(started.id);
    const view = await (await issueAiGet(get("/api/issues/102/ai"), withParams({ number: "102" }))).json();
    const id = view.suggestion.id as string;

    const refused = await outcomePost(json(`/api/ai/results/${id}/outcome`, { outcome: "accepted" }), withParams({ id }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/Editing is off for this deployment/);

    const dismissed = await outcomePost(json(`/api/ai/results/${id}/outcome`, { outcome: "dismissed" }), withParams({ id }));
    expect(dismissed.status).toBe(200);
    const after = await (await issueAiGet(get("/api/issues/102/ai"), withParams({ number: "102" }))).json();
    expect(after.suggestion).toBeNull();
  });

  it("refuses a bad issue number and an issue that is not cached", async () => {
    expect((await issueAiGet(get("/api/issues/abc/ai"), withParams({ number: "abc" }))).status).toBe(400);
    expect((await issueAiGet(get("/api/issues/999999/ai"), withParams({ number: "999999" }))).status).toBe(404);
    expect((await issueAiPost(json("/api/issues/999999/ai"), withParams({ number: "999999" }))).status).toBe(404);
  });

  it("makes no GitHub request for a suggestion (only the cache is read)", async () => {
    await configure();
    fake.reply(claudeOk(await answer(102)));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const started = (await (await issueAiPost(json("/api/issues/102/ai"), withParams({ number: "102" }))).json()).job;
      await finish(started.id);
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("api.github.com"))).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("a queue batch", () => {
  it("runs one job per issue, shares a batch id, and stores every suggestion", async () => {
    await configure();
    fake.reply(claudeOk(await answer(100)), claudeOk(await answer(102)));
    const batch = (await (await queuePost(json("/api/ai/triage-queue", { numbers: [100, 102] }))).json()) as { batchId: string; jobs: { id: string; batchId: string }[] };
    expect(batch.jobs).toHaveLength(2);
    expect(batch.jobs.every((j) => j.batchId === batch.batchId)).toBe(true);
    const jobs = await (await jobsGet(get(`/api/ai/jobs?batch=${batch.batchId}`))).json();
    expect(jobs.jobs).toHaveLength(2);
    await idle();
    expect(batch.jobs.map((j) => getJob(j.id)!.state)).toEqual(["done", "done"]);
    const rows = (await getDb().execute(sql`SELECT count(*)::int AS n FROM ai_results WHERE feature = 'issue-triage'`)).rows[0] as { n: number };
    expect(rows.n).toBe(2);
  });

  it("cancels every running job of the batch", async () => {
    await configure();
    fake.slow(5_000);
    const batch = (await (await queuePost(json("/api/ai/triage-queue", { numbers: [100, 101, 102] }))).json()) as { batchId: string; jobs: { id: string }[] };
    const list = (await (await jobsGet(get(`/api/ai/jobs?batch=${batch.batchId}`))).json()).jobs as { id: string; state: string }[];
    expect(list).toHaveLength(3);
    const active = list.filter((j) => j.state === "queued" || j.state === "running");
    expect(active.length).toBeGreaterThan(0);
    for (const job of active) {
      const res = await cancelPost(json(`/api/ai/jobs/${job.id}/cancel`), withParams({ id: job.id }));
      expect(res.status).toBe(200);
    }
    await idle();
    expect(batch.jobs.map((j) => getJob(j.id)!.state)).toEqual(["cancelled", "cancelled", "cancelled"]);
  });

  it("refuses an empty batch, more than 200 issues, and an issue that is not cached", async () => {
    expect((await queuePost(json("/api/ai/triage-queue", { numbers: [] }))).status).toBe(400);
    const tooMany = Array.from({ length: 201 }, (_, i) => i + 1);
    expect((await queuePost(json("/api/ai/triage-queue", { numbers: tooMany }))).status).toBe(400);
    const missing = await queuePost(json("/api/ai/triage-queue", { numbers: [100, 999999] }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toContain("#999999");
  });
});
