// v5 3.6 against Postgres: one generation bump per sync cycle or drain, and
// deleted issues stay out of the read model.
// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

describe("sync generation (Postgres)", async () => {
  const { getDb } = await import("@/db");
  const { importFull } = await import("@/lib/sync/import");
  const { bumpGenerationOnce, readGeneration } = await import("@/lib/sync/generation");
  const { withLockedSyncKv } = await import("@/lib/sync/runtime");
  const { PostgresStore, readSnapshot } = await import("@/lib/sync/store-postgres");
  const { partialSnapshot } = await import("@/lib/sync/types");
  const { fixtureSnapshot } = await import("../fixtures/github");

  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state RESTART IDENTITY CASCADE`);
    await importFull(fixtureSnapshot(), new PostgresStore());
  });

  const bumpsDuring = async (fn: () => Promise<unknown>) => {
    const before = Number(await readGeneration());
    await fn();
    return Number(await readGeneration()) - before;
  };
  const retitle = (n: number) => {
    const issue = fixtureSnapshot().issues.find((i) => i.nodeId === "I_bug")!;
    return partialSnapshot({ issues: [{ ...issue, title: `Title ${n}`, updatedAt: `2026-10-1${n}T00:00:00Z` }] });
  };

  it("without a batch, every changed page bumps", async () => {
    const store = new PostgresStore();
    expect(await bumpsDuring(async () => {
      await importFull(retitle(1), store);
      await importFull(retitle(2), store);
      await importFull(retitle(3), store);
    })).toBe(3);
  });

  it("a locked sync unit bumps once, however many pages it writes", async () => {
    const store = new PostgresStore();
    const bumps = await bumpsDuring(() =>
      withLockedSyncKv(async () => {
        await importFull(retitle(1), store);
        await importFull(retitle(2), store);
        await importFull(retitle(3), store);
      }),
    );
    expect(bumps).toBe(1);
  });

  it("a batch that changed nothing does not bump, and one that throws still bumps what it wrote", async () => {
    const store = new PostgresStore();
    expect(await bumpsDuring(() => bumpGenerationOnce(async () => { await importFull(retitle(1), store); }))).toBe(1);
    expect(await bumpsDuring(() => bumpGenerationOnce(async () => { await importFull(retitle(1), store); }))).toBe(0); // unchanged
    const failing = bumpsDuring(() =>
      bumpGenerationOnce(async () => {
        await importFull(retitle(2), store);
        throw new Error("cycle died after a page");
      }),
    );
    await expect(failing).rejects.toThrow("cycle died");
    expect(Number(await readGeneration())).toBeGreaterThan(0);
  });

  it("leaves deleted issues, and their items, out of the read model", async () => {
    const before = await readSnapshot();
    expect(before.issues.some((i) => i.nodeId === "I_bug")).toBe(true);
    expect(before.projectItems.some((p) => p.issueNodeId === "I_bug")).toBe(true);
    await getDb().execute(sql`UPDATE issues SET deleted = true, deleted_reason = 'aged-out' WHERE gh_node_id = 'I_bug'`);
    const after = await readSnapshot();
    expect(after.issues.some((i) => i.nodeId === "I_bug")).toBe(false);
    expect(after.projectItems.some((p) => p.issueNodeId === "I_bug")).toBe(false);
    expect(after.projectItems.every((p) => p.issueNodeId !== "")).toBe(true);
    // A child of a deleted parent still names it.
    const sub = after.issues.find((i) => i.nodeId === "I_sub")!;
    expect(sub.parentNodeId).toBe("I_epic");
  });
});
