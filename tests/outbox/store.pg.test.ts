// W0/W1 against Postgres: the single-process outbox, with GitHub faked.
// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

// The cache re-read after a write goes through GitHubSource: fake it, and
// let each test say what "GitHub" holds now.
const github = vi.hoisted(() => ({ issueTitle: "Bug: crash on start", priority: null as string | null }));
vi.mock("@/lib/sync/source-github", async (orig) => {
  const real = await orig<typeof import("@/lib/sync/source-github")>();
  const { fixtureSnapshot } = await import("@/lib/demo/fixtures");
  class FakeSource {
    constructor(_token: string, _ids?: unknown) {}
    async fetchNodes(ids: string[]) {
      const issue = fixtureSnapshot().issues.find((i) => i.nodeId === ids[0])!;
      return new Map([[ids[0]!, { kind: "issue" as const, repo: "acme/widgets", issue: { ...issue, title: github.issueTitle } }]]);
    }
    async fetchProjectItem(nodeId: string) {
      const item = fixtureSnapshot().projectItems.find((p) => p.issueNodeId === nodeId)!;
      return { ...item, priorityOpt: github.priority };
    }
  }
  return { ...real, GitHubSource: FakeSource };
});

type Client = import("@/lib/outbox/worker").WriteClient & { applied: string[] };
function fakeClient(remote: Record<string, unknown>, opts: { failWith?: number } = {}): Client {
  const applied: string[] = [];
  return {
    applied,
    async readField(_node, field) {
      return remote[field ?? ""] ?? null;
    },
    async applyField(_node, field, next) {
      if (opts.failWith) throw Object.assign(new Error(`HTTP ${opts.failWith}`), { status: opts.failWith });
      applied.push(`${field}=${JSON.stringify(next)}`);
      remote[field ?? ""] = next;
    },
    async closeIssue() {
      applied.push("close");
      remote.state = "closed";
    },
    async reopenIssue() {
      applied.push("reopen");
      remote.state = "open";
    },
    async createIssue() {
      return { nodeId: "I_created", number: 999 };
    },
    async addProjectItem() {},
  };
}

describe("the outbox (W0: one process, no lease)", async () => {
  const { getDb } = await import("@/db");
  const { importFull } = await import("@/lib/sync/import");
  const { readGeneration } = await import("@/lib/sync/generation");
  const { PostgresStore, readSnapshot } = await import("@/lib/sync/store-postgres");
  const { getStore, invalidateReadCache } = await import("@/lib/store");
  const { submitEdit } = await import("@/lib/outbox/edit");
  const { drainOutbox, enqueueEdit, getEdit, listOpenEdits, recoverSending, saveStep, STALE_SENDING_MS } = await import("@/lib/outbox/store");
  const { refreshIssue } = await import("@/lib/outbox/runtime");
  const { saveCloseDoneStatus } = await import("@/lib/settings");
  const { fixtureSnapshot } = await import("../fixtures/github");

  const HIGH = "b0000003";
  const LOW = "b0000001";
  const count = async (table: string) => Number((await getDb().execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))).rows[0]!.n);

  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, outbox, audit_log RESTART IDENTITY CASCADE`,
    );
    await importFull(fixtureSnapshot(), new PostgresStore());
    invalidateReadCache();
    github.issueTitle = "Bug: crash on start";
    github.priority = null;
    await saveCloseDoneStatus(null);
  });

  const edit = async (body: Parameters<typeof submitEdit>[0]["body"], client: Client, refresh?: (id: string) => Promise<void>) =>
    submitEdit({
      viewer: "alice",
      token: "t",
      store: await getStore(),
      issueNodeId: "I_bug",
      body,
      deps: (done) => ({ client, doneStatusOptionId: done, refresh, recordStep: (id, step) => saveStep(id, step) }),
    });

  it("success writes once, re-reads the issue into the cache and bumps the generation", async () => {
    const client = fakeClient({ priority: null });
    const gen = Number(await readGeneration());
    github.priority = HIGH;
    github.issueTitle = "Bug: crash on start (edited elsewhere too)";
    const r = await edit({ field: "priority", base: null, next: HIGH }, client, (id) => refreshIssue("t", id));
    expect(r.status).toBe(200);
    expect(r.body.entry).toMatchObject({ status: "done", attempts: 1, step: null });
    expect(client.applied).toEqual([`priority="${HIGH}"`]);
    const snap = await readSnapshot();
    expect(snap.projectItems.find((p) => p.issueNodeId === "I_bug")?.priorityOpt).toBe(HIGH);
    expect(snap.issues.find((i) => i.nodeId === "I_bug")?.title).toBe("Bug: crash on start (edited elsewhere too)");
    expect(Number(await readGeneration())).toBeGreaterThan(gen);
    expect(await count("audit_log")).toBe(1);
  });

  it("a stale base is a conflict with GitHub's value, nothing is written, and the cache is refreshed", async () => {
    const client = fakeClient({ priority: LOW });
    github.priority = LOW;
    const r = await edit({ field: "priority", base: null, next: HIGH }, client, (id) => refreshIssue("t", id));
    expect(r.status).toBe(409);
    expect(r.body.entry).toMatchObject({ status: "conflict", remote: LOW });
    expect(client.applied).toEqual([]);
    expect((await readSnapshot()).projectItems.find((p) => p.issueNodeId === "I_bug")?.priorityOpt).toBe(LOW);
  });

  it("label deltas skip the stale check and are sent by name", async () => {
    const client = fakeClient({ labels: ["something else"] });
    const r = await edit({ field: "labels", next: { added: ["LA_2"], removed: [] } }, client);
    expect(r.status).toBe(200);
    expect(client.applied).toEqual(['labels={"added":["dashboard"],"removed":[]}']);
  });

  it("a non-retryable failure leaves the edit failed", async () => {
    const r = await edit({ field: "priority", base: null, next: HIGH }, fakeClient({ priority: null }, { failWith: 422 }));
    expect(r.status).toBe(502);
    expect(r.body.entry).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("a transient failure backs off through next_attempt_at, and a drain retries it when due", async () => {
    const flaky = fakeClient({ priority: null }, { failWith: 502 });
    const r = await edit({ field: "priority", base: null, next: HIGH }, flaky);
    expect(r.status).toBe(202);
    const entry = r.body.entry!;
    expect(entry).toMatchObject({ status: "pending", attempts: 1 });
    expect(Date.parse(entry.nextAttemptAt!) - Date.now()).toBeGreaterThan(1_000);
    // Not due yet: nothing happens.
    const healthy = fakeClient({ priority: null });
    expect((await drainOutbox(async () => ({ client: healthy, doneStatusOptionId: "" }))).processed).toEqual([]);
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second'`);
    const drained = await drainOutbox(async () => ({ client: healthy, doneStatusOptionId: "" }));
    expect(drained.processed.map((p) => p.status)).toEqual(["done"]);
    expect((await getEdit(entry.id))?.attempts).toBe(2);
  });

  it("a row a crashed request left pending is drained by the next worker cycle", async () => {
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "update", field: "priority", base: null, next: HIGH, idempotencyKey: "alice:crashed" });
    // Nothing claims it: the request died between the insert and its own processEdit.
    const client = fakeClient({ priority: null });
    const drained = await drainOutbox(async () => ({ client, doneStatusOptionId: "" }));
    expect(drained.processed.map((p) => p.id)).toEqual([row.id]);
    expect((await getEdit(row.id))?.status).toBe("done");
  });

  it("two concurrent drains never process the same row", async () => {
    await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "update", field: "priority", base: null, next: HIGH, idempotencyKey: "alice:race" });
    const client = fakeClient({ priority: null });
    client.readField = async () => null;
    const [a, b] = await Promise.all([
      drainOutbox(async () => ({ client, doneStatusOptionId: "" })),
      drainOutbox(async () => ({ client, doneStatusOptionId: "" })),
    ]);
    expect(a.processed.length + b.processed.length).toBe(1);
    expect(client.applied).toHaveLength(1);
  });

  describe("a drain with a backlog", () => {
    const queue = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await enqueueEdit({ userId: "alice", issueNodeId: `I_${i}`, op: "update", field: "priority", base: null, next: HIGH, idempotencyKey: `alice:backlog-${i}` });
      }
    };

    it("processes every due row in one drain", async () => {
      await queue(4);
      const client = fakeClient({ priority: null });
      client.readField = async () => null;
      const { processed } = await drainOutbox(async () => ({ client, doneStatusOptionId: "" }));
      expect(processed.map((p) => p.status)).toEqual(["done", "done", "done", "done"]);
      expect(client.applied).toHaveLength(4);
    });

    it("stops starting rows once the deadline has passed", async () => {
      await queue(3);
      const client = fakeClient({ priority: null });
      const { processed } = await drainOutbox(async () => ({ client, doneStatusOptionId: "" }), { deadline: Date.now() - 1 });
      expect(processed).toEqual([]);
      expect(client.applied).toEqual([]);
      expect((await listOpenEdits()).filter((e) => e.status === "pending")).toHaveLength(3);
    });
  });

  it("a crash between the close and the Status update resumes at the Status step (W0)", async () => {
    // The close lands on GitHub, then the Status write fails with a transient
    // error: the row is pending again with step "close-issue".
    const remote: Record<string, unknown> = { state: "open" };
    const failing: Client = {
      applied: [],
      async readField(_n, field) {
        return remote[field ?? ""] ?? null;
      },
      async closeIssue() {
        remote.state = "closed";
        this.applied.push("close");
      },
      async applyField(_n, _f, _next) {
        this.applied.push("status");
        throw Object.assign(new Error("502"), { status: 502 });
      },
      async reopenIssue() {},
    };
    await saveCloseDoneStatus("a0000006");
    const r = await edit({ field: "state", next: "closed" }, failing);
    expect(r.status).toBe(202);
    expect(r.body.entry).toMatchObject({ status: "pending", step: "close-issue", attempts: 1 });

    // The retry must not close again, and must set Status.
    const second = fakeClient({ state: "closed" });
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second'`);
    const { processed } = await drainOutbox(async () => ({ client: second, doneStatusOptionId: "a0000006", recordStep: (id, step) => saveStep(id, step) }));
    expect(processed.map((p) => p.status)).toEqual(["done"]);
    expect(second.applied).toEqual(['status="a0000006"']);
    expect((await getEdit(r.body.entry!.id))?.step).toBe("set-status-done");
    expect(await count("audit_log")).toBe(1);
  });

  it("a row a crash left sending is recovered and resumed from its step (W0)", async () => {
    // The process died right after GitHub applied the close: the row is still
    // "sending" and its step says the close finished.
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "close", field: null, base: "open", next: "closed", idempotencyKey: "alice:crash" });
    await getDb().execute(sql`UPDATE outbox SET status = 'sending', step = 'close-issue' WHERE id = ${row.id}`);
    expect(await recoverSending()).toBe(1);
    expect((await getEdit(row.id))?.status).toBe("pending");
    const client = fakeClient({ state: "closed" });
    await drainOutbox(async () => ({ client, doneStatusOptionId: "a0000006" }));
    // The issue is already closed: only the Status step is written, once.
    expect(client.applied).toEqual(['status="a0000006"']);
    expect((await getEdit(row.id))?.status).toBe("done");
  });

  it("a close that an earlier try already applied finishes the Status step instead of conflicting (v5 2.2)", async () => {
    // GitHub holds the target state but the row's step was not recorded (the
    // crash happened before saveStep): the retry resumes rather than conflicts.
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "close", field: null, base: "open", next: "closed", idempotencyKey: "alice:crash-before-step" });
    await getDb().execute(sql`UPDATE outbox SET status = 'sending', attempts = 1 WHERE id = ${row.id}`);
    expect(await recoverSending()).toBe(1);
    const client = fakeClient({ state: "closed" });
    await drainOutbox(async () => ({ client, doneStatusOptionId: "a0000006" }));
    expect(client.applied).toEqual(['status="a0000006"']);
    expect((await getEdit(row.id))?.status).toBe("done");
  });

  it("a quit during the FIRST try of a close: the recovered row finishes Status instead of conflicting", async () => {
    // A real crash leaves attempts at 0 (it is only raised when a try finishes)
    // and no step: GitHub took the close, the app quit before it heard back.
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "close", field: null, base: "open", next: "closed", idempotencyKey: "alice:first-try" });
    await getDb().execute(sql`UPDATE outbox SET status = 'sending' WHERE id = ${row.id}`);
    expect(await recoverSending()).toBe(1);
    // The cut-off try counts, so the worker looks at GitHub before sending again.
    expect((await getEdit(row.id))?.attempts).toBe(1);
    const client = fakeClient({ state: "closed" });
    await drainOutbox(async () => ({ client, doneStatusOptionId: "a0000006" }));
    expect(client.applied).toEqual(['status="a0000006"']);
    expect((await getEdit(row.id))?.status).toBe("done");
  });

  it("a quit during the FIRST try of a create: the issue GitHub already made is found, not created again", async () => {
    const payload = { title: "New", body: "", labelNames: [], assigneeLogins: [], milestoneNumber: null, typeId: null, fields: [] };
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "", op: "create", field: null, base: null, next: payload, idempotencyKey: "alice:create-crash" });
    await getDb().execute(sql`UPDATE outbox SET status = 'sending' WHERE id = ${row.id}`);
    expect(await recoverSending()).toBe(1);
    const client = fakeClient({});
    const createIssue = vi.fn(async () => ({ nodeId: "I_second", number: 1000 }));
    const findCreatedIssue = vi.fn(async () => ({ nodeId: "I_created", number: 999 }));
    await drainOutbox(async () => ({ client: { ...client, createIssue, findCreatedIssue }, doneStatusOptionId: "", recordStep: (id, step, result) => saveStep(id, step, result) }));
    expect(findCreatedIssue).toHaveBeenCalledTimes(1);
    expect(createIssue).not.toHaveBeenCalled();
    expect(await getEdit(row.id)).toMatchObject({ status: "done", result: { nodeId: "I_created", number: 999 } });
  });

  it("a row left sending with the app still running is recovered once it is stale, not before", async () => {
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "update", field: "priority", base: null, next: HIGH, idempotencyKey: "alice:stuck" });
    await getDb().execute(sql`UPDATE outbox SET status = 'sending', updated_at = now() WHERE id = ${row.id}`);
    expect(await recoverSending(STALE_SENDING_MS)).toBe(0);
    await getDb().execute(sql`UPDATE outbox SET updated_at = now() - interval '11 minutes' WHERE id = ${row.id}`);
    expect(await recoverSending(STALE_SENDING_MS)).toBe(1);
    expect((await getEdit(row.id))?.status).toBe("pending");
  });

  it("a close with no Done Status fails before anything is sent (it used to close the issue first)", async () => {
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "close", field: null, base: "open", next: "closed", idempotencyKey: "alice:no-done" });
    const client = fakeClient({ state: "open" });
    await drainOutbox(async () => ({ client, doneStatusOptionId: "" }));
    expect(client.applied).toEqual([]);
    expect(await getEdit(row.id)).toMatchObject({ status: "failed", attempts: 0 });
    expect((await getEdit(row.id))?.error).toMatch(/Done Status/);
  });

  it("any edit request carries the Done Status, so a close queued behind it can run", async () => {
    await saveCloseDoneStatus("a0000006");
    invalidateReadCache();
    let seen: string | null = null;
    await submitEdit({
      viewer: "alice",
      token: "t",
      store: await getStore(),
      issueNodeId: "I_bug",
      body: { field: "priority", base: null, next: HIGH },
      deps: (done) => ((seen = done), { client: fakeClient({ priority: null }), doneStatusOptionId: done }),
    });
    expect(seen).toBe("a0000006");
  });

  it("a label delta is written without reading the issue first", async () => {
    const client = fakeClient({});
    const readField = vi.fn(async () => {
      throw Object.assign(new Error("HTTP 404"), { status: 404 });
    });
    const label = [...(await getStore()).labels.keys()][0]!;
    const r = await edit({ field: "labels", next: { added: [label], removed: [] } }, { ...client, readField });
    expect(r.status).toBe(200);
    expect(readField).not.toHaveBeenCalled();
    expect(client.applied).toHaveLength(1);
  });

  it("edits to the same issue and field run in order: a queued add cannot undo a later remove (v5 1.6)", async () => {
    const labels = new Set<string>();
    let failAdd = 1;
    const client = {
      applied: [] as string[],
      async readField() {
        return [...labels].sort();
      },
      async applyField(_n: string, _f: string | null, next: unknown) {
        const delta = next as { added: string[]; removed: string[] };
        if (delta.added.length && failAdd-- > 0) throw Object.assign(new Error("502"), { status: 502 }); // lands on GitHub in the real case; here it just fails
        for (const l of delta.added) labels.add(l);
        for (const l of delta.removed) labels.delete(l);
      },
      async closeIssue() {},
      async reopenIssue() {},
      async createIssue() {
        return { nodeId: "I_created", number: 999 };
      },
      async addProjectItem() {},
    };
    const add = await edit({ field: "labels", next: { added: ["LA_2"], removed: [] } }, client);
    expect(add.status).toBe(202); // 502: queued for a retry
    const remove = await edit({ field: "labels", next: { added: [], removed: ["LA_2"] } }, client);
    expect(remove.status).toBe(202); // behind the add, not on the fast path
    expect([...labels]).toEqual([]);

    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending' AND next_attempt_at IS NOT NULL`);
    const { processed } = await drainOutbox(async () => ({ client, doneStatusOptionId: "x" }));
    expect(processed.map((r) => r.status)).toEqual(["done", "done"]);
    expect(processed.map((r) => (r.next as { added: string[] }).added.length)).toEqual([1, 0]); // add first, then remove
    expect([...labels]).toEqual([]); // X stays removed
  });

  it("outbox timestamps carry a time zone, so a non-UTC session cannot shift a retry", async () => {
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "update", field: "priority", base: null, next: HIGH, idempotencyKey: "alice:tz" });
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() + interval '10 minutes' WHERE id = ${row.id}`);
    const types = (await getDb().execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'outbox' AND column_name IN ('next_attempt_at','created_at','updated_at')`)).rows as { data_type: string }[];
    expect(types.map((t) => t.data_type)).toEqual(["timestamp with time zone", "timestamp with time zone", "timestamp with time zone"]);

    // Read it back in far-apart session time zones, as `due` does (next_attempt_at <= now()).
    const { getPglite } = await import("@/db");
    const pg = getPglite();
    try {
      for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
        await pg.exec(`SET TIME ZONE '${zone}'`);
        const r = await pg.query<{ due: boolean }>("SELECT next_attempt_at <= now() AS due FROM outbox WHERE id = $1", [row.id]);
        expect(r.rows[0]!.due, zone).toBe(false);
      }
    } finally {
      await pg.exec("RESET TIME ZONE");
    }
  });

  it("no stored token: a leftover fails instead of waiting forever", async () => {
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "update", field: "priority", base: null, next: HIGH, idempotencyKey: "alice:1" });
    await drainOutbox(async () => null);
    expect((await getEdit(row.id))?.status).toBe("failed");
  });

  it("close without a Done Status chosen in Settings returns 422 and writes nothing (W2)", async () => {
    const client = fakeClient({ state: "open" });
    const r = await edit({ field: "state", next: "closed" }, client);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("Choose a Done Status for closing in Settings → Project and fields");
    expect(await count("outbox")).toBe(0);
    expect(client.applied).toEqual([]);
    await saveCloseDoneStatus("not-an-option");
    expect((await edit({ field: "state", next: "closed" }, client)).status).toBe(422);
  });

  it("close with the Done Status chosen in Settings closes, then sets Status", async () => {
    await saveCloseDoneStatus("a0000006");
    const client = fakeClient({ state: "open" });
    const r = await edit({ field: "state", next: "closed" }, client);
    expect(r.status).toBe(200);
    expect(client.applied).toEqual(["close", 'status="a0000006"']);
  });

  it("the same idempotency key is one edit; a new key for the same value is a new one", async () => {
    const client = fakeClient({ priority: null });
    const first = await edit({ field: "priority", base: null, next: HIGH, idempotencyKey: "click-1" }, client);
    const again = await edit({ field: "priority", base: null, next: HIGH, idempotencyKey: "click-1" }, client);
    expect(again.body.entry!.id).toBe(first.body.entry!.id);
    expect(client.applied).toHaveLength(1);
    // HIGH -> LOW -> HIGH: three actions, three writes.
    await edit({ field: "priority", base: HIGH, next: LOW, idempotencyKey: "click-2" }, client);
    await edit({ field: "priority", base: LOW, next: HIGH, idempotencyKey: "click-3" }, client);
    expect(client.applied).toHaveLength(3);
  });

  it("refuses unknown options, labels and assignees; lists the open edits", async () => {
    const client = fakeClient({ priority: null, labels: [] });
    expect((await edit({ field: "priority", next: "nope" }, client)).status).toBe(400);
    expect((await edit({ field: "labels", next: { added: ["LA_missing"], removed: [] } }, client)).status).toBe(400);
    expect((await edit({ field: "assignees", next: { added: ["nobody-here"], removed: [] } }, client)).status).toBe(400);
    await edit({ field: "priority", base: LOW, next: HIGH }, fakeClient({ priority: null }));
    expect((await listOpenEdits()).map((e) => e.status)).toEqual(["conflict"]);
  });

describe("each §4.8 planning field goes through the outbox (W1)", () => {
  it("writes the mapped dimension, Release, Type and Milestone by ID", async () => {
    const cases: { body: Parameters<typeof submitEdit>[0]["body"]; expected: string }[] = [
      { body: { field: "dim:PVTSSF_acme_team", base: null, next: "c0000002" }, expected: 'dim:PVTSSF_acme_team="c0000002"' },
      { body: { field: "release", base: null, next: "e0000023" }, expected: 'release="e0000023"' },
      { body: { field: "type", base: "IT_acme_bug", next: "IT_acme_feature" }, expected: 'type="IT_acme_feature"' },
      { body: { field: "milestone", base: null, next: "M_1" }, expected: 'milestone="M_1"' },
    ];
    for (const c of cases) {
      const client = fakeClient({ type: "IT_acme_bug" });
      const r = await edit(c.body, client);
      expect(r.status, JSON.stringify(c.body)).toBe(200);
      expect(client.applied).toEqual([c.expected]);
    }
  });

  it("two edits to different labels both survive: deltas commute and skip the stale check", async () => {
    const labels = new Set<string>();
    const client = fakeClient({ labels: [] });
    client.applyField = async (_n, _f, next) => {
      const d = next as { added: string[]; removed: string[] };
      for (const l of d.added) labels.add(l);
      for (const l of d.removed) labels.delete(l);
    };
    expect((await edit({ field: "labels", next: { added: ["LA_1"], removed: [] } }, client)).status).toBe(200);
    expect((await edit({ field: "labels", next: { added: ["LA_2"], removed: [] } }, client)).status).toBe(200);
    expect([...labels].sort()).toEqual(["UI", "dashboard"]);
  });
});
});
