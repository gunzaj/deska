// S6 against Postgres: the nightly reconcile on a fixture source.
// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));

describe("nightly reconcile (Postgres)", async () => {
  const { getDb, onQuery } = await import("@/db");
  const { fieldOptions, issues } = await import("@/db/schema");
  const { importFull } = await import("@/lib/sync/import");
  const { readGeneration } = await import("@/lib/sync/generation");
  const { MapKv } = await import("@/lib/sync/poll");
  const { reconcile } = await import("@/lib/sync/reconcile");
  const { runNightly } = await import("@/lib/sync/nightly");
  const { PostgresStore } = await import("@/lib/sync/store-postgres");
  const { invalidateReadCache, getStore } = await import("@/lib/store");
  const { cachedDetail } = await import("@/lib/server/issue-detail");
  const { GET: data } = await import("@/app/api/data/route");
  const { fixtureSnapshot } = await import("../fixtures/github");
  type FetchedNode = import("@/lib/sync/source-github").FetchedNode;

  const REPO = "acme/widgets";
  const CUTOFF = "2026-07-15T00:00:00Z";
  const NOW = new Date("2026-10-13T03:00:00Z");

  /** GitHub as the fixtures describe it, with per-test changes. */
  function fakeSource(over: { open?: string[]; nodes?: Record<string, FetchedNode | null>; fields?: ReturnType<typeof fixtureSnapshot>["fields"] } = {}) {
    const snap = fixtureSnapshot();
    const realIssues = snap.issues.filter((i) => !i.isPullRequest);
    return {
      repoName: REPO,
      fetchMetadata: vi.fn(async () => ({ projectId: snap.projectId, fields: over.fields ?? snap.fields, issueTypes: snap.issueTypes, labels: snap.labels, milestones: snap.milestones })),
      listOpenNodeIds: vi.fn(async () => ({
        issues: over.open ?? realIssues.filter((i) => i.state === "open").map((i) => i.nodeId),
      })),
      fetchNodes: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, over.nodes?.[id] ?? null] as const))),
    };
  }

  async function reset() {
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, tasks, task_links RESTART IDENTITY CASCADE`,
    );
    await importFull(fixtureSnapshot(), new PostgresStore());
  }
  const row = async (nodeId: string) => (await getDb().select().from(issues).where(sql`${issues.ghNodeId} = ${nodeId}`))[0]!;

  beforeEach(reset);

  it("an issue removed from GitHub is marked deleted and disappears from /api/data", async () => {
    const res = await reconcile(fakeSource({ open: ["I_epic", "I_sub"] }), new PostgresStore(), new MapKv(), { closedCutoff: CUTOFF, now: NOW });
    expect(res).toMatchObject({ refetched: 1, deleted: 1, transferred: 0 });
    expect(await row("I_bug")).toMatchObject({ deleted: true, deletedReason: "deleted" });

    invalidateReadCache();
    const body = await (await data(new NextRequest("http://x/api/data"))).json();
    expect(body.issues.map((i: { n: number }) => i.n).sort()).toEqual([100, 101]);
    // The panel still serves it by number, with a note.
    const detail = await cachedDetail(await getStore(), 102, "GitHub request failed");
    expect(detail?.commentsError).toMatch(/no longer on GitHub \(it was deleted\)/);
  });

  it("a transferred issue is marked deleted", async () => {
    const bug = fixtureSnapshot().issues.find((i) => i.nodeId === "I_bug")!;
    const res = await reconcile(fakeSource({ open: ["I_epic", "I_sub"], nodes: { I_bug: { kind: "issue", repo: "acme/other-repo", issue: bug } } }), new PostgresStore(), new MapKv(), { closedCutoff: CUTOFF, now: NOW });
    expect(res).toMatchObject({ deleted: 0, transferred: 1 });
    expect(await row("I_bug")).toMatchObject({ deleted: true, deletedReason: "transferred" });
  });

  it("an issue closed on GitHub is upserted, not deleted", async () => {
    const bug = fixtureSnapshot().issues.find((i) => i.nodeId === "I_bug")!;
    const closed = { ...bug, state: "closed", stateReason: "completed", closedAt: "2026-10-12T10:00:00Z", updatedAt: "2026-10-12T10:00:00Z" };
    await reconcile(fakeSource({ open: ["I_epic", "I_sub"], nodes: { I_bug: { kind: "issue", repo: REPO, issue: closed } } }), new PostgresStore(), new MapKv(), { closedCutoff: CUTOFF, now: NOW });
    expect(await row("I_bug")).toMatchObject({ deleted: false, state: "closed" });
  });

  it("closed issues older than the window age out, unless a task links them or they parent an open issue", async () => {
    const old = { state: "closed", closedAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z" };
    const snap = fixtureSnapshot();
    snap.issues = snap.issues.map((i) => (i.nodeId === "I_bug" || i.nodeId === "I_epic" ? { ...i, ...old } : i));
    // Start from no issues: an older payload no longer overwrites a newer row (v5 2.1).
    await getDb().execute(sql`TRUNCATE issues RESTART IDENTITY CASCADE`);
    await importFull(snap, new PostgresStore());
    // A second old closed issue that a task links.
    const linked = { ...snap.issues.find((i) => i.nodeId === "I_bug")!, nodeId: "I_linked", number: 150, title: "Linked old issue" };
    await importFull({ ...snap, issues: [linked], projectItems: [] }, new PostgresStore());
    await getDb().execute(sql`INSERT INTO tasks (id, creator_login, title) VALUES ('00000000-0000-0000-0000-000000000001', 'alice', 'Follow up')`);
    await getDb().execute(sql`INSERT INTO task_links (task_id, target_kind, target_node_id, target_number) VALUES ('00000000-0000-0000-0000-000000000001', 'issue', 'I_linked', 150)`);

    const res = await reconcile(fakeSource({ open: ["I_sub"] }), new PostgresStore(), new MapKv(), { closedCutoff: CUTOFF, now: NOW });
    expect(await row("I_bug")).toMatchObject({ deleted: true, deletedReason: "aged-out" });
    expect((await row("I_linked")).deleted).toBe(false);
    // I_epic is closed and old, but the parent of the open I_sub.
    expect((await row("I_epic")).deleted).toBe(false);
    expect(res.agedOut).toBe(1);
  });

  it("a second run in a row writes nothing", async () => {
    const source = fakeSource({ open: ["I_epic", "I_sub"] });
    await reconcile(source, new PostgresStore(), new MapKv(), { closedCutoff: CUTOFF, now: NOW });
    const gen = await readGeneration();
    const seen: string[] = [];
    const stop = onQuery((q) => seen.push(q.trim()));
    let second;
    try {
      second = await reconcile(source, new PostgresStore(), new MapKv(), { closedCutoff: CUTOFF, now: NOW });
    } finally {
      stop();
    }
    expect(second).toMatchObject({ refetched: 0, deleted: 0, transferred: 0, agedOut: 0, metadata: { inserted: 0, updated: 0 } });
    expect(seen.filter((s) => /^(update|delete)\b/i.test(s))).toEqual([]);
    expect(await readGeneration()).toBe(gen);
  });

  it("marks an option GitHub stopped returning as missing, and restores it", async () => {
    const fields = fixtureSnapshot().fields.map((f) => (f.name === "Status" ? { ...f, options: f.options!.filter((o) => o.id !== "a0000006") } : f));
    await reconcile(fakeSource({ fields }), new PostgresStore(), new MapKv(), { closedCutoff: CUTOFF, now: NOW });
    const opt = async () => (await getDb().select().from(fieldOptions).where(sql`${fieldOptions.id} = 'a0000006'`))[0];
    expect((await opt())?.missingAt).toBeInstanceOf(Date);
    invalidateReadCache();
    const statusOptions = [...(await getStore()).fields.values()].find((f) => f.name === "Status")!.options.map((o) => o.id);
    expect(statusOptions).not.toContain("a0000006");

    await reconcile(fakeSource(), new PostgresStore(), new MapKv(), { closedCutoff: CUTOFF, now: NOW });
    expect((await opt())?.missingAt).toBeNull();
  });

  it("respects rate limits like the scans", async () => {
    const kv = new MapKv();
    const source = fakeSource({ open: ["I_epic", "I_sub"] });
    source.listOpenNodeIds.mockRejectedValueOnce(Object.assign(new Error("API rate limit exceeded"), { status: 403, headers: { "x-ratelimit-remaining": "0", "retry-after": "60" } }));
    const res = await runNightly(source, new PostgresStore(), kv, { now: NOW });
    expect(res).toMatchObject({ ran: true, reconcile: { rateLimited: true } });
    expect(kv.get("reconcile.lastRun")).toBeNull();
    expect(source.fetchNodes).not.toHaveBeenCalled();
    expect((await row("I_bug")).deleted).toBe(false);

    // While limited, nothing calls GitHub.
    source.fetchMetadata.mockClear();
    await runNightly(source, new PostgresStore(), kv, { now: NOW });
    expect(source.fetchMetadata).not.toHaveBeenCalled();
  });

  it("a run that failed waits an hour before the next try, not one cycle", async () => {
    const kv = new MapKv();
    const source = fakeSource();
    source.fetchMetadata.mockRejectedValue(new Error("boom"));
    await expect(runNightly(source, new PostgresStore(), kv, { now: NOW })).rejects.toThrow("boom");
    expect(kv.get("reconcile.lastRun")).toBeNull();
    // The next cycle, a minute later: not tried again.
    expect(await runNightly(source, new PostgresStore(), kv, { now: new Date(NOW.getTime() + 60_000) })).toEqual({ ran: false, reason: "not-due" });
    expect(source.fetchMetadata).toHaveBeenCalledTimes(1);
    // An hour later it is, and a run that works clears the wait.
    source.fetchMetadata.mockReset();
    const good = fakeSource();
    source.fetchMetadata.mockImplementation(good.fetchMetadata);
    expect((await runNightly(source, new PostgresStore(), kv, { now: new Date(NOW.getTime() + 3600_000) })).ran).toBe(true);
    expect(kv.get("reconcile.failedAt")).toBe("");
    expect(kv.get("reconcile.lastRun")).toBeTruthy();
  });

  it("runs once a day", async () => {
    const kv = new MapKv();
    expect((await runNightly(fakeSource(), new PostgresStore(), kv, { now: NOW })).ran).toBe(true);
    expect(await runNightly(fakeSource(), new PostgresStore(), kv, { now: new Date(NOW.getTime() + 3600_000) })).toEqual({ ran: false, reason: "not-due" });
    expect((await runNightly(fakeSource(), new PostgresStore(), kv, { now: new Date(NOW.getTime() + 25 * 3600_000) })).ran).toBe(true);
  });
});
