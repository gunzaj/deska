// W1 against Postgres: the durable outbox, with GitHub faked.
// Skipped unless TEST_DATABASE_URL points at a throwaway, migrated database.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

type Client = import("@/lib/outbox/worker").WriteClient & { applied: string[] };
function fakeClient(remote: Record<string, unknown>, opts: { failWith?: number; delayMs?: number } = {}): Client {
  const applied: string[] = [];
  return {
    applied,
    async readField(_node, field) {
      return remote[field ?? ""] ?? null;
    },
    async applyField(_node, field, next) {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
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
  };
}

suite("durable outbox (Postgres)", async () => {
  const { getDb } = await import("@/db");
  const { importFull } = await import("@/lib/sync/import");
  const { readGeneration } = await import("@/lib/sync/generation");
  const { PostgresStore, readSnapshot } = await import("@/lib/sync/store-postgres");
  const { getStore, invalidateReadCache } = await import("@/lib/store");
  const { submitEdit } = await import("@/lib/outbox/edit");
  const { drainOutbox, enqueueEdit, getEdit, listOpenEdits, processEdit } = await import("@/lib/outbox/store");
  const { refreshIssue } = await import("@/lib/outbox/runtime");
  const { fixtureSnapshot } = await import("../fixtures/github");

  const HIGH = "b0000003";
  const LOW = "b0000001";
  const count = async (table: string) => Number((await getDb().execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))).rows[0]!.n);

  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });
  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, outbox, audit_log RESTART IDENTITY CASCADE`,
    );
    await importFull(fixtureSnapshot(), new PostgresStore());
    invalidateReadCache();
    github.issueTitle = "Bug: crash on start";
    github.priority = null;
    delete process.env.STATUS_DONE_OPTION_ID;
  });
  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  const edit = async (body: Parameters<typeof submitEdit>[0]["body"], client: Client, refresh?: (id: string) => Promise<void>) =>
    submitEdit({ viewer: "alice", token: "t", store: await getStore(), issueNodeId: "I_bug", body, deps: (done) => ({ client, doneStatusOptionId: done, refresh }) });

  it("success writes once, re-reads the issue into the cache and bumps the generation", async () => {
    const client = fakeClient({ priority: null });
    const gen = Number(await readGeneration());
    github.priority = HIGH;
    github.issueTitle = "Bug: crash on start (edited elsewhere too)";
    const r = await edit({ field: "priority", base: null, next: HIGH }, client, (id) => refreshIssue("t", id));
    expect(r.status).toBe(200);
    expect(r.body.entry).toMatchObject({ status: "done", attempts: 1 });
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

  it("an edit left pending by a crashed request is drained by the next worker cycle", async () => {
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "update", field: "priority", base: null, next: HIGH, idempotencyKey: "alice:crashed" });
    // Younger than a minute: still the request's own.
    const client = fakeClient({ priority: null });
    expect((await drainOutbox(async () => ({ client, doneStatusOptionId: "" }))).processed).toEqual([]);
    await getDb().execute(sql`UPDATE outbox SET created_at = now() - interval '2 minutes' WHERE id = ${row.id}`);
    const drained = await drainOutbox(async () => ({ client, doneStatusOptionId: "" }));
    expect(drained.processed.map((p) => p.id)).toEqual([row.id]);
    expect((await getEdit(row.id))?.status).toBe("done");
  });

  it("two concurrent drains never process the same row", async () => {
    await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "update", field: "priority", base: null, next: HIGH, idempotencyKey: "alice:race" });
    await getDb().execute(sql`UPDATE outbox SET created_at = now() - interval '2 minutes'`);
    const client = fakeClient({ priority: null }, { delayMs: 300 });
    const [a, b] = await Promise.all([
      drainOutbox(async () => ({ client, doneStatusOptionId: "" })),
      drainOutbox(async () => ({ client, doneStatusOptionId: "" })),
    ]);
    expect(a.processed.length + b.processed.length).toBe(1);
    expect(client.applied).toHaveLength(1);
  });

  describe("a drain with a backlog (v5 2.3)", () => {
    const queue = async (n: number) => {
      for (let i = 0; i < n; i++) {
        await enqueueEdit({ userId: "alice", issueNodeId: `I_${i}`, op: "update", field: "priority", base: null, next: HIGH, idempotencyKey: `alice:backlog-${i}` });
      }
      await getDb().execute(sql`UPDATE outbox SET created_at = now() - interval '2 minutes'`);
    };

    it("processes all of one user's rows in one drain, not one per tick", async () => {
      await queue(4);
      // Each row is a different issue. The fake keeps one remote value per field,
      // so after the first write the others would read as already applied.
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
      // The rows stay pending for the next drain.
      expect((await listOpenEdits("alice")).filter((e) => e.status === "pending")).toHaveLength(3);
    });
  });

  it("a run that outlived its lease cannot overwrite the second run's result (v5 1.5, 2.2)", async () => {
    // The first run closes the issue, then stalls (a slow GitHub call). Its
    // lease expires and a drain takes the row over; the second run finds the
    // issue closed. It must finish the job (Status = Done) instead of recording
    // a conflict over the user's own close, and the first run's late result
    // must be dropped.
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "close", field: null, base: "open", next: "closed", idempotencyKey: "alice:fence" });
    const remote: Record<string, unknown> = { state: "open" };
    const statusWrites: string[] = [];
    const first = {
      async readField(_n: string, field: string | null) {
        return remote[field ?? ""] ?? null;
      },
      async closeIssue() {
        remote.state = "closed"; // applied on GitHub at once ...
        await new Promise((r) => setTimeout(r, 600)); // ... but the call does not return in time
      },
      async applyField(_n: string, _f: string | null, next: unknown) {
        statusWrites.push(`first:${String(next)}`);
      },
      async reopenIssue() {},
    };
    const second = { ...first, async closeIssue() { throw new Error("must not close twice"); }, async applyField(_n: string, _f: string | null, next: unknown) { statusWrites.push(`second:${String(next)}`); } };

    const firstRun = processEdit(row.id, { client: first, doneStatusOptionId: "a0000006" });
    await new Promise((r) => setTimeout(r, 150));
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second' WHERE id = ${row.id}`);
    await drainOutbox(async () => ({ client: second, doneStatusOptionId: "a0000006" }), { olderThanMs: 0 });
    expect((await getEdit(row.id))?.status).toBe("done");

    const late = await firstRun; // its own result was fenced out
    expect(late?.status).toBe("done");
    // The first run still finishes its own steps (the same Status value); only
    // its recorded result is dropped, so there is one audit row and no conflict.
    expect(statusWrites).toContain("second:a0000006");
    expect(await count("audit_log")).toBe(1);
    expect((await getEdit(row.id))?.error).toBeNull();
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
    };
    const add = await edit({ field: "labels", next: { added: ["LA_2"], removed: [] } }, client);
    expect(add.status).toBe(202); // 502: queued for a retry
    const remove = await edit({ field: "labels", next: { added: [], removed: ["LA_2"] } }, client);
    expect(remove.status).toBe(202); // behind the add, not on the fast path
    expect([...labels]).toEqual([]);

    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second' WHERE status = 'pending' AND next_attempt_at IS NOT NULL`);
    const { processed } = await drainOutbox(async () => ({ client, doneStatusOptionId: "x" }), { olderThanMs: 0 });
    expect(processed.map((r) => r.status)).toEqual(["done", "done"]);
    expect(processed.map((r) => (r.next as { added: string[] }).added.length)).toEqual([1, 0]); // add first, then remove
    expect([...labels]).toEqual([]); // X stays removed
  });

  it("outbox timestamps carry a time zone, so a non-UTC session cannot shift leases (v5 2.5)", async () => {
    const { Client } = await import("pg");
    const row = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "update", field: "priority", base: null, next: HIGH, idempotencyKey: "alice:tz" });
    // A lease 10 minutes out, written the way the store writes it (a UTC Date).
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() + interval '10 minutes' WHERE id = ${row.id}`);
    const types = (await getDb().execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'outbox' AND column_name IN ('next_attempt_at','created_at','updated_at')`)).rows as { data_type: string }[];
    expect(types.map((t) => t.data_type)).toEqual(["timestamp with time zone", "timestamp with time zone", "timestamp with time zone"]);

    // Read it back from sessions in far-apart zones, as `due` does (next_attempt_at <= now()).
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
      const client = new Client({ connectionString: url });
      await client.connect();
      try {
        await client.query(`SET TIME ZONE '${zone}'`);
        const r = await client.query("SELECT next_attempt_at <= now() AS due FROM outbox WHERE id = $1", [row.id]);
        expect(r.rows[0].due, zone).toBe(false);
      } finally {
        await client.end();
      }
    }
  });

  it("no stored token: a leftover fails instead of waiting forever", async () => {
    const row = await enqueueEdit({ userId: "ghost", issueNodeId: "I_bug", op: "update", field: "priority", base: null, next: HIGH, idempotencyKey: "ghost:1" });
    await getDb().execute(sql`UPDATE outbox SET created_at = now() - interval '2 minutes'`);
    await drainOutbox(async () => null);
    expect((await getEdit(row.id))?.status).toBe("failed");
  });

  it("close without STATUS_DONE_OPTION_ID returns 422 and writes nothing", async () => {
    const client = fakeClient({ state: "open" });
    const r = await edit({ field: "state", next: "closed" }, client);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("STATUS_DONE_OPTION_ID not set or unknown");
    expect(await count("outbox")).toBe(0);
    expect(client.applied).toEqual([]);
    process.env.STATUS_DONE_OPTION_ID = "not-an-option";
    expect((await edit({ field: "state", next: "closed" }, client)).status).toBe(422);
  });

  it("close with the done option closes, then sets Status", async () => {
    process.env.STATUS_DONE_OPTION_ID = "a0000006";
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

  it("refuses unknown options, labels and assignees; lists the viewer's open edits", async () => {
    const client = fakeClient({ priority: null, labels: [] });
    expect((await edit({ field: "priority", next: "nope" }, client)).status).toBe(400);
    expect((await edit({ field: "labels", next: { added: ["LA_missing"], removed: [] } }, client)).status).toBe(400);
    expect((await edit({ field: "assignees", next: { added: ["nobody-here"], removed: [] } }, client)).status).toBe(400);
    await edit({ field: "priority", base: LOW, next: HIGH }, fakeClient({ priority: null }));
    expect((await listOpenEdits("alice")).map((e) => e.status)).toEqual(["conflict"]);
  });
});
