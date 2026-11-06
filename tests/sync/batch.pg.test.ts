// S4 against Postgres: page-sized transactions, no rewrites of unchanged rows,
// and a project scan that resumes from its checkpoint.
// Skipped unless TEST_DATABASE_URL points at a throwaway, migrated database.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projectItems } from "@/db/schema";
import { scanProject } from "@/lib/sync/cycle";
import { importFull } from "@/lib/sync/import";
import { syncFull } from "@/lib/sync/initial";
import { MapKv } from "@/lib/sync/poll";
import { PostgresStore, readSnapshot } from "@/lib/sync/store-postgres";
import type { SnapshotIssue, SnapshotProjectItem } from "@/lib/sync/types";
import { fixtureSnapshot } from "../fixtures/github";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
// A scan only prunes items last written before it began (v5 1.4): its start must be later than the test's own writes.
const SCAN_START = new Date(Date.now() + 60_000).toISOString();
const SCAN_RESUME = new Date(Date.now() + 120_000).toISOString();

async function truncate() {
  await getDb().execute(
    sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, pull_requests, pr_labels, pr_assignees, pr_review_requests, pr_reviews, pr_issue_links, gh_team_members RESTART IDENTITY CASCADE`,
  );
}

/** Every SQL statement sent while `fn` runs. */
async function statementsDuring(fn: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const original = Client.prototype.query;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation(function (this: Client, ...args: unknown[]) {
    const q = args[0] as string | { text?: string };
    seen.push((typeof q === "string" ? q : (q?.text ?? "")).trim());
    return (original as (...a: unknown[]) => unknown).apply(this, args) as never;
  });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return seen;
}

const issue = (n: number): SnapshotIssue => ({
  nodeId: `I_s${n}`,
  number: 500 + n,
  title: `Scan issue ${n}`,
  body: "",
  state: "open",
  stateReason: null,
  typeId: null,
  parentNodeId: null,
  milestoneId: null,
  authorLogin: "alice",
  url: `https://github.com/acme/widgets/issues/${500 + n}`,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  closedAt: null,
  labelIds: [],
  assigneeIds: [],
});
const item = (n: number, status: string | null = "a0000001"): SnapshotProjectItem => ({
  itemId: `PVTI_s${n}`,
  issueNodeId: `I_s${n}`,
  statusOpt: status,
  priorityOpt: null,
  teamOpt: null,
  platformOpt: null,
  releaseIter: null,
});

suite("batched Postgres sync writes (S4)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });
  beforeEach(truncate);
  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  it("sync:full twice: the second run reports nothing changed and sends no UPDATE or DELETE", async () => {
    const snapshot = fixtureSnapshot();
    const first = await syncFull(snapshot, new PostgresStore(), { waitMs: 0 });
    expect(first.ran && first.value.first.inserted).toBeGreaterThan(0);

    const results: Awaited<ReturnType<typeof syncFull>>[] = [];
    const statements = await statementsDuring(async () => {
      results.push(await syncFull(snapshot, new PostgresStore(), { waitMs: 0 }));
    });
    const second = results[0]!;
    if (!second.ran) throw new Error("lock not taken");
    expect(second.value.first).toMatchObject({ inserted: 0, updated: 0 });
    expect(second.value.second).toMatchObject({ inserted: 0, updated: 0 });
    // sync_state cursors are upserted (INSERT … ON CONFLICT), the cache isn't touched.
    expect(statements.filter((s) => /^(update|delete)\b/i.test(s)).map((s) => s.slice(0, 80))).toEqual([]);
  });

  it("writes a changed field and reports exactly that update", async () => {
    const store = new PostgresStore();
    const snapshot = fixtureSnapshot();
    await importFull(snapshot, store);
    snapshot.projectItems = snapshot.projectItems.map((p, i) => (i === 0 ? { ...p, statusOpt: "a0000006" } : p));
    const before = snapshot.issues[0]!.labelIds;
    const next = before.includes("LA_2") ? before.filter((l) => l !== "LA_2") : [...before, "LA_2"];
    snapshot.issues = snapshot.issues.map((x, i) => (i === 0 ? { ...x, labelIds: next } : x));
    const stats = await importFull(snapshot, store);
    expect(stats).toMatchObject({ inserted: 0, updated: 2 });
    const read = await readSnapshot();
    expect(read.projectItems.find((p) => p.itemId === snapshot.projectItems[0]!.itemId)?.statusOpt).toBe("a0000006");
    expect(read.issues.find((x) => x.nodeId === snapshot.issues[0]!.nodeId)?.labelIds.sort()).toEqual([...next].sort());
  });

  it("links a child to a parent that arrives on a later page", async () => {
    const store = new PostgresStore();
    const issues = Array.from({ length: 150 }, (_, i) => issue(i + 1));
    // #1 is on page 1, its parent #150 on page 2.
    issues[0] = { ...issues[0]!, parentNodeId: "I_s150" };
    await importFull({ ...fixtureSnapshot(), issues, projectItems: [], pullRequests: [] }, store);
    const read = await readSnapshot();
    expect(read.issues.find((x) => x.nodeId === "I_s1")?.parentNodeId).toBe("I_s150");
  });

  it("moves a project item between issues without hitting the one-item-per-issue index (R1)", async () => {
    const store = new PostgresStore();
    // Issue A holds item X; issue B holds item Y.
    const issues = [issue(1), issue(2)];
    const seeded = [
      { ...item(1), itemId: "PVTI_move" },
      { ...item(2), itemId: "PVTI_keep" },
    ];
    await importFull({ ...fixtureSnapshot(), issues, projectItems: seeded, pullRequests: [] }, store);
    // X is now B's item and A has none; B's old item Y is gone.
    const moved = [{ ...item(2), itemId: "PVTI_move", statusOpt: "a0000006" }];
    const stats = await importFull({ ...fixtureSnapshot(), issues, projectItems: moved, pullRequests: [] }, store);
    expect(stats.inserted + stats.updated).toBeGreaterThan(0);
    const read = await readSnapshot();
    const forB = read.projectItems.filter((p) => p.issueNodeId === "I_s2");
    expect(forB).toHaveLength(1);
    expect(forB[0]!.itemId).toBe("PVTI_move");
    expect(read.projectItems.some((p) => p.issueNodeId === "I_s1")).toBe(false);
  });

  it("a scan that throws on page 3 of 5 keeps pages 1–2, does not prune, then resumes at page 3 and prunes", async () => {
    const store = new PostgresStore();
    const issues = Array.from({ length: 11 }, (_, i) => issue(i + 1));
    // A stale item from an earlier scan (its own issue): GitHub no longer lists it.
    await importFull({ ...fixtureSnapshot(), issues: [...fixtureSnapshot().issues, ...issues], projectItems: [{ ...item(11), itemId: "PVTI_stale" }] }, store);

    const pages = [0, 1, 2, 3, 4].map((p) => [item(p * 2 + 1), item(p * 2 + 2)]);
    let failPage3 = true;
    const calls: (string | null)[] = [];
    const source = {
      scanProjectItems: vi.fn(async (cursor: string | null) => {
        calls.push(cursor);
        const n = cursor ? Number(cursor.slice(1)) : 0;
        if (n === 2 && failPage3) throw new Error("GitHub 502");
        return { items: pages[n]!, nextCursor: n < 4 ? `c${n + 1}` : null, total: 10 };
      }),
    };
    const kv = new MapKv();
    await expect(scanProject(source, store, kv, SCAN_START)).rejects.toThrow("GitHub 502");

    const ids = async () => (await getDb().select({ id: projectItems.ghItemId }).from(projectItems)).map((r) => r.id).sort();
    expect(await ids()).toEqual(["PVTI_s1", "PVTI_s2", "PVTI_s3", "PVTI_s4", "PVTI_stale"].sort());
    expect(kv.get("project.scanCursor")).toBe("c2");
    expect(kv.get("project.lastScan")).toBeNull();

    failPage3 = false;
    calls.length = 0;
    const res = await scanProject(source, store, kv, SCAN_RESUME);
    expect(calls).toEqual(["c2", "c3", "c4"]);
    expect(res).toMatchObject({ resumed: true, pages: 3, removed: 1 });
    expect(await ids()).toEqual(pages.flat().map((p) => p.itemId).sort());
    expect(kv.get("project.scanCursor")).toBe("");
    expect(kv.get("project.lastScan")).toBe(SCAN_RESUME);
    const [{ n }] = (await getDb().execute(sql`SELECT count(*)::int AS n FROM project_scan_seen`)).rows as [{ n: number }];
    expect(n).toBe(0);
  });

  it("an item written after the scan started survives its prune (v5 1.4)", async () => {
    const store = new PostgresStore();
    const issues = Array.from({ length: 3 }, (_, i) => issue(i + 1));
    await importFull({ ...fixtureSnapshot(), issues: [...fixtureSnapshot().issues, ...issues], projectItems: [{ ...item(1), itemId: "PVTI_old" }] }, store);

    const kv = new MapKv();
    const startedAt = new Date().toISOString();
    // While the scan runs, a refresh inserts an item for issue 3 (an outbox
    // write, or a page the scan had already passed). The scan never lists it.
    await new Promise((r) => setTimeout(r, 20));
    const source = {
      scanProjectItems: vi.fn(async () => {
        await importFull({ ...fixtureSnapshot(), issues: [], projectItems: [item(3)], pullRequests: [] }, store);
        return { items: [item(2)], nextCursor: null, total: 1 };
      }),
    };
    const res = await scanProject(source, store, kv, startedAt);
    const ids = (await getDb().select({ id: projectItems.ghItemId }).from(projectItems)).map((r) => r.id);
    expect(ids).toContain("PVTI_s3"); // added mid-scan: kept
    expect(ids).toContain("PVTI_s2");
    expect(ids).not.toContain("PVTI_old"); // old and unseen: pruned
    expect(res.removed).toBeGreaterThan(0);
  });

  it("an item a scan missed and then restores is not scope added (v5 1.4)", async () => {
    const store = new PostgresStore();
    const issues = [issue(1)];
    const base = { ...fixtureSnapshot(), issues: [...fixtureSnapshot().issues, ...issues], pullRequests: [] };
    await importFull({ ...base, projectItems: [{ ...item(1), releaseIter: "e0000023" }, fixtureSnapshot().projectItems[0]!] }, store);

    // A scan lists only the fixture item: PVTI_s1 is pruned (positional paging missed it).
    const kv = new MapKv();
    const res = await scanProject({ scanProjectItems: async () => ({ items: [fixtureSnapshot().projectItems[0]!], nextCursor: null, total: 1 }) }, store, kv, SCAN_START);
    expect(res.removed).toBe(1);

    // The next scan finds it again, with the same Release.
    await importFull({ ...base, projectItems: [{ ...item(1), releaseIter: "e0000023" }] }, store);
    const { listFieldChanges } = await import("@/lib/server/changes");
    const scope = await listFieldChanges({ since: new Date(Date.now() - 3600_000), fields: ["release"], newValue: "e0000023" });
    expect(scope.filter((c) => c.issueNodeId === "I_s1")).toEqual([]);
    const rows = (await getDb().execute(sql`SELECT field, source FROM issue_field_changes ORDER BY observed_at`)).rows as { field: string; source: string }[];
    expect(rows.some((r) => r.source === "restore")).toBe(true);
    expect(rows.some((r) => r.field === "item")).toBe(false); // the tombstone is used up
  });
});
