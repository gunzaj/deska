// Integration test for PostgresStore. Runs on an in-memory
// PGlite database (tests/setup/db.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { PostgresStore, readSnapshot } from "@/lib/sync/store-postgres";
import { fixtureSnapshot } from "../fixtures/github";

async function truncate() {
  const db = getDb();
  await db.execute(
    sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state RESTART IDENTITY CASCADE`,
  );
}

describe("PostgresStore round-trip", () => {
  beforeAll(async () => {
    await truncate();
  });

  it("imports the fixture snapshot, and a re-import changes nothing", async () => {
    const store = new PostgresStore();
    const snapshot = fixtureSnapshot();

    const first = await importFull(snapshot, store);
    expect(first.inserted).toBeGreaterThan(0);

    const second = await importFull(snapshot, store);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
  });

  it("preserves issue type and parent links through readSnapshot", async () => {
    const snapshot = await readSnapshot();
    const epic = snapshot.issues.find((i) => i.number === 100);
    const sub = snapshot.issues.find((i) => i.number === 101);
    expect(epic?.typeId).toBe("IT_acme_feature");
    expect(sub?.parentNodeId).toBe("I_epic");
    expect(epic?.labelIds).toEqual(["LA_1"]);
    expect(epic?.assigneeIds).toEqual(["U_1"]);
  });

  it("keeps project field values (Status/Priority/Release and dimensions by field ID)", async () => {
    const snapshot = await readSnapshot();
    const epic = snapshot.projectItems.find((p) => p.issueNodeId === "I_epic");
    expect(epic?.statusOpt).toBe("a0000001");
    expect(epic?.priorityOpt).toBe("b0000003");
    expect(epic?.dims?.PVTSSF_acme_team).toBe("c0000001");
    expect(epic?.dims?.PVTSSF_acme_status).toBe("a0000001");
    expect(epic?.releaseIter).toBe("e0000023");
  });

  it("drops an assignee when GitHub reports none", async () => {
    const store = new PostgresStore();
    const snapshot = fixtureSnapshot();
    snapshot.issues = snapshot.issues.map((i) =>
      i.nodeId === "I_epic" ? { ...i, assigneeIds: [] } : i,
    );
    await importFull(snapshot, store);
    const after = await readSnapshot();
    expect(after.issues.find((i) => i.number === 100)?.assigneeIds).toEqual([]);
  });

  it("re-keys a provisional label onto its real node ID", async () => {
    const store = new PostgresStore();
    const provisional = await store.labelId("brand new");
    await store.upsertLabel({ id: "LA_9", name: "brand new", color: "red", description: "" });
    expect(await store.labelId("brand new")).toBe("LA_9");
    // The provisional row must not linger and collide on the unique name.
    const after = await readSnapshot();
    expect(after.labels.filter((l) => l.name === "brand new")).toHaveLength(1);
    expect(provisional).not.toBe("LA_9");
  });

  it("skips project items whose issue is not cached instead of aborting the scan", async () => {
    const store = new PostgresStore();
    const stats = await importFull(
      {
        ...fixtureSnapshot(),
        fields: [], issueTypes: [], labels: [], milestones: [], ghUsers: [], issues: [],
        projectItems: [
          { itemId: "PVTI_foreign", issueNodeId: "I_other_repo", statusOpt: null, priorityOpt: null, releaseIter: null },
          { itemId: "PVTI_3", issueNodeId: "I_bug", statusOpt: "a0000002", priorityOpt: null, releaseIter: null },
        ],
      },
      store,
    );
    expect(stats.updated).toBe(1);
    const snapshot = await readSnapshot();
    expect(snapshot.projectItems.find((p) => p.itemId === "PVTI_3")?.statusOpt).toBe("a0000002");
    // Restore for the following tests.
    await importFull(fixtureSnapshot(), store);
  });

  it("excludes pull requests", async () => {
    const snapshot = await readSnapshot();
    expect(snapshot.issues.find((i) => i.number === 103)).toBeUndefined();
  });

  it("feeds the same view rows the memory store would produce", async () => {
    const { buildViewRows } = await import("@/lib/views/rows");
    const dbSnapshot = await readSnapshot();
    const memory = new MemoryStore();
    await importFull(fixtureSnapshot(), memory);

    const fromDb = buildViewRowsFrom(await buildDbStore(dbSnapshot));
    const fromMem = buildViewRows(memory);
    expect(fromDb.map((r) => [r.number, r.statusId, r.priorityId, r.releaseId])).toEqual(
      fromMem.map((r) => [r.number, r.statusId, r.priorityId, r.releaseId]),
    );
  });
  it("never stores the pull request the REST issue list carries, and a re-import writes nothing (D6)", async () => {
    const store = new PostgresStore();
    const snapshot = fixtureSnapshot();
    expect(snapshot.issues.some((i) => i.isPullRequest)).toBe(true);
    await importFull(snapshot, store);
    const read = await readSnapshot();
    expect(read.issues.map((i) => i.number)).not.toContain(103);
    expect(Object.keys(read)).not.toContain("pullRequests");
    const again = await importFull(snapshot, store);
    expect(again.inserted).toBe(0);
    expect(again.updated).toBe(0);
  });

  it("prunes project items a full scan no longer lists, and never on an empty scan", async () => {
    const store = new PostgresStore();
    const before = (await readSnapshot()).projectItems.map((p) => p.itemId);
    expect(before.length).toBeGreaterThan(1);
    expect(await store.pruneUnseenProjectItems("scan-empty")).toBe(0);
    await store.markScanSeen("scan-1", [before[0]!]);
    expect(await store.pruneUnseenProjectItems("scan-1")).toBe(before.length - 1);
    expect((await readSnapshot()).projectItems.map((p) => p.itemId)).toEqual([before[0]]);
    await importFull(fixtureSnapshot(), store);
  });

  it("shares the project scan time across processes", async () => {
    const { getSyncKv } = await import("@/lib/sync/runtime");
    await getDb().execute(sql`INSERT INTO sync_state (key, value) VALUES ('project.lastScan', '2026-10-12T12:00:00Z') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    const kv = await getSyncKv();
    expect(kv.get("project.lastScan")).toBe("2026-10-12T12:00:00Z");
  });
});

async function buildDbStore(snapshot: Awaited<ReturnType<typeof readSnapshot>>) {
  const store = new MemoryStore();
  await importFull(snapshot, store);
  return store;
}

// Imported lazily so the helper above can reference it without a cycle.
import { buildViewRows } from "@/lib/views/rows";
function buildViewRowsFrom(store: MemoryStore) {
  return buildViewRows(store);
}