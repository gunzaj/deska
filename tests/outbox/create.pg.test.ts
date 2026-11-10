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
