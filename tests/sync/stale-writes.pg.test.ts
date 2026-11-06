// v5 2.1 against Postgres: an older payload never overwrites a newer cache row.
// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { importFull } from "@/lib/sync/import";
import { PostgresStore, readSnapshot } from "@/lib/sync/store-postgres";
import { partialSnapshot } from "@/lib/sync/types";
import { fixtureSnapshot } from "../fixtures/github";

describe("a stale payload cannot go backwards (v5 2.1)", () => {
  beforeAll(async () => {
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state RESTART IDENTITY CASCADE`,
    );
    await importFull(fixtureSnapshot(), new PostgresStore());
  });

  it("keeps a newer issue row when an older payload arrives later", async () => {
    const store = new PostgresStore();
    const issue = fixtureSnapshot().issues.find((i) => i.nodeId === "I_bug")!;
    await importFull(partialSnapshot({ issues: [{ ...issue, title: "Newer title", updatedAt: "2026-10-12T10:00:00Z" }] }), store);
    // A scan page fetched before the edit commits after the refresh.
    await importFull(partialSnapshot({ issues: [{ ...issue, title: "Older title", updatedAt: "2026-10-12T09:00:00Z" }] }), store);
    const read = await readSnapshot();
    expect(read.issues.find((i) => i.nodeId === "I_bug")).toMatchObject({ title: "Newer title", updatedAt: "2026-10-12T10:00:00.000Z" });
    // An equal or newer payload still applies.
    await importFull(partialSnapshot({ issues: [{ ...issue, title: "Newest title", updatedAt: "2026-10-12T11:00:00Z" }] }), store);
    expect((await readSnapshot()).issues.find((i) => i.nodeId === "I_bug")?.title).toBe("Newest title");
  });

  it("keeps a newer project item when an older page arrives later", async () => {
    const store = new PostgresStore();
    const item = fixtureSnapshot().projectItems.find((p) => p.issueNodeId === "I_bug")!;
    await importFull(partialSnapshot({ projectItems: [{ ...item, statusOpt: "a0000006", updatedAt: "2026-10-12T10:00:00Z" }] }), store);
    await importFull(partialSnapshot({ projectItems: [{ ...item, statusOpt: "a0000001", updatedAt: "2026-10-12T09:00:00Z" }] }), store);
    expect((await readSnapshot()).projectItems.find((p) => p.issueNodeId === "I_bug")?.statusOpt).toBe("a0000006");
    // A payload with no timestamp (older fixtures) still applies.
    await importFull(partialSnapshot({ projectItems: [{ ...item, statusOpt: "a0000002" }] }), store);
    expect((await readSnapshot()).projectItems.find((p) => p.issueNodeId === "I_bug")?.statusOpt).toBe("a0000002");
  });
});
