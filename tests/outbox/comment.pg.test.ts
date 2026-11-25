// Posting a comment through the outbox (SPEC §4.8), with GitHub faked.
// Runs on an in-memory PGlite database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("@/lib/sync/source-github", async (orig) => {
  const real = await orig<typeof import("@/lib/sync/source-github")>();
  const { fixtureSnapshot } = await import("@/lib/demo/fixtures");
  class FakeSource {
    constructor(_token: string, _ids?: unknown) {}
    async fetchNodes(ids: string[]) {
      const issue = fixtureSnapshot().issues.find((i) => i.nodeId === ids[0])!;
      return new Map([[ids[0]!, { kind: "issue" as const, repo: "acme/widgets", issue }]]);
    }
    async fetchProjectItem(nodeId: string) {
      return fixtureSnapshot().projectItems.find((p) => p.issueNodeId === nodeId) ?? null;
    }
  }
  return { ...real, GitHubSource: FakeSource };
});

describe("posting a comment (SPEC §4.8)", async () => {
  const { getDb } = await import("@/db");
  const { fixtureSnapshot } = await import("../fixtures/github");
  const { importFull } = await import("@/lib/sync/import");
  const { PostgresStore } = await import("@/lib/sync/store-postgres");
  const { getStore, invalidateReadCache } = await import("@/lib/store");
  const { submitComment } = await import("@/lib/outbox/comment");
  const { drainOutbox, failPendingEdits, getEdit, listOpenEdits, saveStep, SIGN_IN_CHANGED } = await import("@/lib/outbox/store");

  const fake = (opts: { fail?: number[]; earlier?: boolean } = {}) => {
    const calls: string[] = [];
    const fail = [...(opts.fail ?? [])];
    return {
      calls,
      async addComment(_node: string, body: string) {
        calls.push(`post:${body}`);
        const status = fail.shift();
        if (status) throw Object.assign(new Error(`HTTP ${status}`), { status });
        return { id: String(9000 + calls.length), url: "https://github.com/acme/widgets/issues/102#issuecomment-1" };
      },
      async findComment() {
        calls.push("find");
        return opts.earlier ? { id: "42", url: "https://github.com/acme/widgets/issues/102#issuecomment-42" } : null;
      },
      async readField() {
        calls.push("read");
        return null;
      },
      async applyField() {},
      async closeIssue() {},
      async reopenIssue() {},
    };
  };
  type Fake = ReturnType<typeof fake>;
  const depsOf = (client: Fake) => ({ client, doneStatusOptionId: "", recordStep: (id: string, step: string, result?: unknown) => saveStep(id, step, result) });
  const submit = async (body: string, client: Fake, idempotencyKey?: string) =>
    submitComment({ viewer: "Alice", token: "t", store: await getStore(), issueNodeId: "I_bug", body: { body, idempotencyKey }, deps: () => depsOf(client) });
  const audit = async () => (await getDb().execute(sql`SELECT field, new, result FROM audit_log ORDER BY at, id`)).rows;

  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, app_settings, outbox, audit_log RESTART IDENTITY CASCADE`,
    );
    await importFull(fixtureSnapshot(), new PostgresStore());
    invalidateReadCache();
  });

  it("posts the trimmed text, returns the comment and writes an audit row", async () => {
    const client = fake();
    const r = await submit("  Looks good to me.\n", client);
    expect(r.status).toBe(201);
    expect(r.body.entry).toMatchObject({ op: "comment", field: "comment", status: "done", userId: "alice", issueNodeId: "I_bug", next: { body: "Looks good to me." } });
    expect(r.body.entry?.result).toEqual({ id: "9001", url: "https://github.com/acme/widgets/issues/102#issuecomment-1" });
    // No read before the write: a comment has no stale check.
    expect(client.calls).toEqual(["post:Looks good to me."]);
    expect(await audit()).toEqual([{ field: "comment", new: { body: "Looks good to me." }, result: "done" }]);
    expect(await listOpenEdits()).toEqual([]);
  });

  it("refuses an empty comment before anything is stored", async () => {
    const client = fake();
    expect((await submit(" \n ", client)).status).toBe(400);
    expect(client.calls).toEqual([]);
    expect(await listOpenEdits()).toEqual([]);
  });

  it("the same action sent twice is one comment", async () => {
    const client = fake();
    const first = await submit("Once", client, "key-12345678");
    const second = await submit("Once", client, "key-12345678");
    expect(second.status).toBe(201);
    expect(second.body.entry?.id).toBe(first.body.entry?.id);
    expect(client.calls).toEqual(["post:Once"]);
  });

  it("a transient failure is queued (202); the retry looks on GitHub first, then posts", async () => {
    const client = fake({ fail: [502] });
    const r = await submit("Later", client);
    expect(r.status).toBe(202);
    expect(r.body.entry).toMatchObject({ status: "pending", attempts: 1 });
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second'`);
    const { processed } = await drainOutbox(async () => depsOf(client));
    expect(processed.map((p) => p.status)).toEqual(["done"]);
    expect(client.calls).toEqual(["post:Later", "find", "post:Later"]);
  });

  it("a retry that finds the comment on GitHub does not post it again", async () => {
    const client = fake({ fail: [502], earlier: true });
    const r = await submit("Already there", client);
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second'`);
    await drainOutbox(async () => depsOf(client));
    expect(client.calls).toEqual(["post:Already there", "find"]);
    expect(await getEdit(r.body.entry!.id)).toMatchObject({ status: "done", result: { id: "42" } });
  });

  it("a refusal fails with GitHub's reason (502) and stays listed", async () => {
    const r = await submit("Locked", fake({ fail: [403] }));
    expect(r.status).toBe(502);
    expect(r.body.entry).toMatchObject({ status: "failed", error: expect.stringContaining("HTTP 403") });
    expect((await listOpenEdits()).map((e) => e.status)).toEqual(["failed"]);
  });

  it("a second comment waits for the first: they reach GitHub in order", async () => {
    const client = fake({ fail: [502] });
    expect((await submit("First", client)).status).toBe(202);
    const second = await submit("Second", client);
    // Not sent while "First" waits on its retry.
    expect(second.status).toBe(202);
    expect(client.calls).toEqual(["post:First"]);
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second'`);
    await drainOutbox(async () => depsOf(client));
    expect(client.calls.filter((c) => c.startsWith("post"))).toEqual(["post:First", "post:First", "post:Second"]);
  });

  it("a sign-in change fails a queued comment; it is never sent later", async () => {
    const client = fake({ fail: [502] });
    const r = await submit("Not as someone else", client);
    expect(await failPendingEdits(SIGN_IN_CHANGED)).toBe(1);
    await drainOutbox(async () => depsOf(client));
    expect(client.calls).toEqual(["post:Not as someone else"]);
    expect(await getEdit(r.body.entry!.id)).toMatchObject({ status: "failed", error: SIGN_IN_CHANGED });
  });
});
