// W3: creating an issue through one outbox job (SPEC §4.8), with GitHub faked.
// Runs on an in-memory PGlite database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const github = vi.hoisted(() => ({ created: new Set<string>() }));
vi.mock("@/lib/sync/source-github", async (orig) => {
  const real = await orig<typeof import("@/lib/sync/source-github")>();
  const { fixtureSnapshot } = await import("@/lib/demo/fixtures");
  class FakeSource {
    constructor(_token: string, _ids?: unknown) {}
    async fetchNodes(ids: string[]) {
      const snapshot = fixtureSnapshot();
      const out = new Map<string, unknown>();
      for (const id of ids) {
        if (id === "I_created") {
          out.set(id, {
            kind: "issue" as const,
            repo: "acme/widgets",
            issue: { ...snapshot.issues.find((i) => i.nodeId === "I_bug")!, nodeId: "I_created", number: 999, title: "Created from the form" },
          });
          github.created.add(id);
        } else {
          const issue = snapshot.issues.find((i) => i.nodeId === id);
          if (issue) out.set(id, { kind: "issue" as const, repo: "acme/widgets", issue });
        }
      }
      return out;
    }
    async fetchProjectItem() {
      return null;
    }
  }
  return { ...real, GitHubSource: FakeSource };
});

describe("creating an issue (W3)", async () => {
  const { getDb } = await import("@/db");
  const { fixtureSnapshot } = await import("../fixtures/github");
  const { importFull } = await import("@/lib/sync/import");
  const { PostgresStore, readSnapshot } = await import("@/lib/sync/store-postgres");
  const { getStore, invalidateReadCache } = await import("@/lib/store");
  const { resetSettingsCache, saveCloseDoneStatus, saveMapping } = await import("@/lib/settings");
  const { setLocalToken } = await import("@/lib/github/local-token");
  const { submitCreate } = await import("@/lib/outbox/create");
  const { drainOutbox, getEdit, saveStep } = await import("@/lib/outbox/store");
  const { refreshIssue } = await import("@/lib/outbox/runtime");

  const TOKEN = ["github", "pat", "CREATE", "FAKE", "0".repeat(24)].join("_");

  const fake = (opts: { failAdd?: boolean } = {}) => {
    const calls: string[] = [];
    return {
      calls,
      async createIssue() {
        calls.push("create");
        return { nodeId: "I_created", number: 999 };
      },
      async addProjectItem() {
        calls.push("add-project");
        if (opts.failAdd) throw Object.assign(new Error("502"), { status: 502 });
      },
      async applyField(_n: string, field: string | null, next: unknown) {
        calls.push(`field:${field}=${JSON.stringify(next)}`);
      },
      async readField() {
        return null;
      },
      async closeIssue() {},
      async reopenIssue() {},
    };
  };

  const submit = async (body: Parameters<typeof submitCreate>[0]["body"], deps: ReturnType<typeof fake>) =>
    submitCreate({
      viewer: "alice",
      token: TOKEN,
      store: await getStore(),
      body,
      deps: (done) => ({ client: deps, doneStatusOptionId: done, recordStep: (id, step, result) => saveStep(id, step, result) }),
    });

  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, app_settings, outbox, audit_log RESTART IDENTITY CASCADE`,
    );
    await importFull(fixtureSnapshot(), new PostgresStore());
    invalidateReadCache();
    const store = await getStore();
    await saveMapping(store.projectFieldMap());
    invalidateReadCache();
    resetSettingsCache();
    await saveCloseDoneStatus("a0000006");
    setLocalToken(TOKEN, "launch");
    github.created.clear();
  });

  it("validates the form's fields against the discovered metadata by ID", async () => {
    const client = fake();
    expect((await submit({ title: "  " }, client)).status).toBe(400);
    expect((await submit({ title: "New", labelIds: ["LA_missing"] }, client)).status).toBe(400);
    expect((await submit({ title: "New", assigneeLogins: ["nobody"] }, client)).status).toBe(400);
    expect((await submit({ title: "New", typeId: "IT_missing" }, client)).status).toBe(400);
    expect((await submit({ title: "New", milestoneId: "M_missing" }, client)).status).toBe(400);
    expect((await submit({ title: "New", fields: [{ field: "priority", next: "b_missing" }] }, client)).status).toBe(400);
    expect(client.calls).toEqual([]);
  });

  it("creates the issue, adds it to the project, sets the mapped fields and the Type", async () => {
    const client = fake();
    const r = await submit(
      {
        title: "New issue",
        body: "From the form",
        typeId: "IT_acme_feature",
        milestoneId: "M_1",
        labelIds: ["LA_1"],
        assigneeLogins: ["alice"],
        fields: [
          { field: "status", next: "a0000001" },
          { field: "priority", next: "b0000003" },
          { field: "release", next: "e0000023" },
          { field: "dim:PVTSSF_acme_team", next: "c0000001" },
        ],
      },
      client,
    );
    expect(r.status).toBe(201);
    expect(r.body.entry).toMatchObject({ status: "done", step: "set-type", result: { nodeId: "I_created", number: 999 } });
    expect(client.calls).toEqual([
      "create",
      "add-project",
      'field:status="a0000001"',
      'field:priority="b0000003"',
      'field:release="e0000023"',
      'field:dim:PVTSSF_acme_team="c0000001"',
      'field:type="IT_acme_feature"',
    ]);
  });

  it("a failure part-way resumes without creating a second issue", async () => {
    const failing = fake({ failAdd: true });
    const first = await submit({ title: "New issue", fields: [{ field: "priority", next: "b0000003" }] }, failing);
    expect(first.status).toBe(202);
    expect(first.body.entry).toMatchObject({ status: "pending", step: "create-issue", result: { nodeId: "I_created", number: 999 } });
    expect(failing.calls).toEqual(["create", "add-project"]);

    // The retry must not create again; it continues at the add-to-project step.
    const second = fake();
    second.createIssue = async () => {
      throw new Error("must not create a second issue");
    };
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second'`);
    const { processed } = await drainOutbox(async () => ({ client: second, doneStatusOptionId: "a0000006", recordStep: (id, step) => saveStep(id, step) }));
    expect(processed.map((p) => p.status)).toEqual(["done"]);
    expect(second.calls).toEqual(["add-project", 'field:priority="b0000003"']);
    expect((await getEdit(first.body.entry!.id))?.status).toBe("done");
  });

  it("re-reads the issue it made, not an empty node ID, and audits it by that ID", async () => {
    const refreshed: string[] = [];
    const client = fake();
    const r = await submitCreate({
      viewer: "alice",
      token: TOKEN,
      store: await getStore(),
      body: { title: "New issue" },
      deps: (done) => ({
        client,
        doneStatusOptionId: done,
        recordStep: (id, step, result) => saveStep(id, step, result),
        refresh: async (id) => void refreshed.push(id),
      }),
    });
    expect(r.status).toBe(201);
    expect(refreshed).toEqual(["I_created"]);
    const audit = await getDb().execute(sql`SELECT issue_node_id FROM audit_log`);
    expect(audit.rows).toEqual([{ issue_node_id: "I_created" }]);
  });

  it("a create whose answer was lost is looked up on retry, not sent again", async () => {
    const lost = fake();
    lost.createIssue = async () => {
      lost.calls.push("create");
      throw Object.assign(new Error("timeout"), { status: 500 });
    };
    const first = await submit({ title: "New issue" }, lost);
    expect(first.status).toBe(202);
    expect(first.body.entry).toMatchObject({ status: "pending", result: null });

    const second = Object.assign(fake(), {
      async findCreatedIssue(payload: { title: string }, since: Date) {
        second.calls.push(`find:${payload.title}`);
        expect(since.getTime()).toBeLessThanOrEqual(Date.now());
        return { nodeId: "I_created", number: 999 };
      },
    });
    second.createIssue = async () => {
      throw new Error("must not create a second issue");
    };
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second'`);
    const { processed } = await drainOutbox(async () => ({ client: second, doneStatusOptionId: "a0000006", recordStep: (id, step, result) => saveStep(id, step, result) }));
    expect(processed.map((p) => p.status)).toEqual(["done"]);
    expect(second.calls).toEqual(["find:New issue", "add-project"]);
    expect((await getEdit(first.body.entry!.id))?.result).toEqual({ nodeId: "I_created", number: 999 });
  });

  it("a retried create that GitHub never made is sent again", async () => {
    const lost = fake();
    lost.createIssue = async () => {
      throw Object.assign(new Error("reset"), { status: 0 });
    };
    await submit({ title: "New issue" }, lost);
    const second = Object.assign(fake(), { findCreatedIssue: async () => null });
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second'`);
    const { processed } = await drainOutbox(async () => ({ client: second, doneStatusOptionId: "a0000006", recordStep: (id, step, result) => saveStep(id, step, result) }));
    expect(processed.map((p) => p.status)).toEqual(["done"]);
    expect(second.calls).toEqual(["create", "add-project"]);
  });

  it("without a way to look up an earlier create, a retry fails rather than risk a duplicate", async () => {
    const lost = fake();
    lost.createIssue = async () => {
      throw Object.assign(new Error("502"), { status: 502 });
    };
    await submit({ title: "New issue" }, lost);
    const second = fake();
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() - interval '1 second'`);
    const { processed } = await drainOutbox(async () => ({ client: second, doneStatusOptionId: "a0000006" }));
    expect(processed.map((p) => p.status)).toEqual(["failed"]);
    expect(processed[0]?.error).toMatch(/may already have created/);
    expect(second.calls).toEqual([]);
  });

  it("a create waiting on its retry window does not hold back a later create", async () => {
    const failing = fake({ failAdd: true });
    const first = await submit({ title: "First issue" }, failing);
    expect(first.status).toBe(202);
    expect(first.body.entry).toMatchObject({ status: "pending" });

    // The second create is independent: it takes the fast path and finishes now.
    const client = fake();
    const second = await submit({ title: "Second issue" }, client);
    expect(second.status).toBe(201);
    expect(second.body.entry).toMatchObject({ status: "done" });
    // ...and does not pull the first one out of its retry window as a "follower".
    expect(client.calls).toEqual(["create", "add-project"]);
    expect((await getEdit(first.body.entry!.id))?.status).toBe("pending");
  });

  it("the re-read puts the created issue in the cache once", async () => {
    const client = fake();
    const r = await submit({ title: "New issue" }, client);
    expect(r.status).toBe(201);
    await refreshIssue(TOKEN, "I_created");
    const snapshot = await readSnapshot();
    expect(snapshot.issues.filter((i) => i.nodeId === "I_created").map((i) => i.number)).toEqual([999]);
    await refreshIssue(TOKEN, "I_created");
    expect((await readSnapshot()).issues.filter((i) => i.nodeId === "I_created")).toHaveLength(1);
  });
});
