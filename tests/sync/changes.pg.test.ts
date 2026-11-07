// F0 against Postgres: field change history written by the sync upserts.
// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { importFull } from "@/lib/sync/import";
import { PostgresStore } from "@/lib/sync/store-postgres";
import { fixtureSnapshot } from "../fixtures/github";

async function truncate() {
  await getDb().execute(
    sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state RESTART IDENTITY CASCADE`,
  );
}

const changes = async () =>
  (await getDb().execute(sql`SELECT i.gh_node_id AS node, c.field, c.old_value AS "old", c.new_value AS "new", c.source FROM issue_field_changes c JOIN issues i ON i.id = c.issue_id ORDER BY c.field`)).rows as {
    node: string;
    field: string;
    old: string | null;
    new: string | null;
    source: string;
  }[];

describe("field change history (F0)", () => {
  beforeEach(truncate);

  it("the initial import writes zero rows", async () => {
    await importFull(fixtureSnapshot(), new PostgresStore());
    expect(await changes()).toEqual([]);
  });

  it("a sync that changes an issue's Release writes exactly one row; running it again writes none", async () => {
    const store = new PostgresStore();
    const snapshot = fixtureSnapshot();
    await importFull(snapshot, store);
    const target = snapshot.projectItems[0]!;
    const releases = snapshot.fields.find((f) => f.name === "Release")?.iterations ?? [];
    const other = releases.find((r) => r.id !== target.releaseIter)!.id;
    const moved = { ...snapshot, projectItems: snapshot.projectItems.map((p) => (p === target ? { ...p, releaseIter: other } : p)) };
    await importFull(moved, store);
    expect(await changes()).toEqual([{ node: target.issueNodeId, field: "release", old: target.releaseIter, new: other, source: "sync" }]);
    await importFull(moved, store);
    expect((await changes()).length).toBe(1);
  });

  it("records state, labels and assignees, and tags a Deska write as source=deska", async () => {
    const store = new PostgresStore();
    const snapshot = fixtureSnapshot();
    await importFull(snapshot, store);
    const first = snapshot.issues[0]!;
    const next = {
      ...snapshot,
      projectItems: [],
      issues: snapshot.issues.map((i) => (i === first ? { ...i, state: "closed", labelIds: [...i.labelIds, "LA_extra"], assigneeIds: [] } : i)),
    };
    await importFull(next, store, { source: "deska" });
    const rows = (await changes()).filter((r) => r.node === first.nodeId);
    expect(rows.map((r) => r.field).sort()).toEqual(first.assigneeIds.length ? ["assignees", "labels", "state"] : ["labels", "state"]);
    expect(rows.every((r) => r.source === "deska")).toBe(true);
    expect(rows.find((r) => r.field === "state")).toMatchObject({ old: "open", new: "closed" });
    expect(JSON.parse(rows.find((r) => r.field === "labels")!.new!)).toContain("LA_extra");
  });

  it("an issue that is new in the import carries no history for what it arrives with", async () => {
    const store = new PostgresStore();
    const snapshot = fixtureSnapshot();
    const newcomer = snapshot.issues[0]!.nodeId;
    await importFull({ ...snapshot, issues: snapshot.issues.slice(1), projectItems: snapshot.projectItems.filter((p) => p.issueNodeId !== newcomer) }, store);
    await importFull(snapshot, store);
    expect(await changes()).toEqual([]);
  });
});

import { listFieldChanges } from "@/lib/server/changes";

describe("reading field changes (F0/F2)", () => {
  beforeEach(truncate);

  it("lists changes since a date that set a given Release, and none for issues present at the start", async () => {
    const store = new PostgresStore();
    const snapshot = fixtureSnapshot();
    await importFull(snapshot, store);
    const target = snapshot.projectItems[0]!;
    const other = (snapshot.fields.find((f) => f.name === "Release")?.iterations ?? []).find((r) => r.id !== target.releaseIter)!.id;
    await importFull({ ...snapshot, projectItems: snapshot.projectItems.map((p) => (p === target ? { ...p, releaseIter: other } : p)) }, store);
    const since = new Date(Date.now() - 60_000);
    const added = await listFieldChanges({ since, fields: ["release"], newValue: other });
    expect(added.map((c) => c.issueNodeId)).toEqual([target.issueNodeId]);
    expect(await listFieldChanges({ since: new Date(Date.now() + 60_000), fields: ["release"], newValue: other })).toEqual([]);
    expect(await listFieldChanges({ since, fields: ["release"], newValue: target.releaseIter! })).toEqual([]);
  });
});
