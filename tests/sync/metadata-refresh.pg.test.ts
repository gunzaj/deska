// A label, milestone, option or sprint created on GitHub since the last
// metadata fetch reaches the cache as a bare ID. The cycle that leaves one
// behind reads the metadata right away instead of waiting for the daily
// reconcile, and an ID the metadata never explains costs one fetch, not one
// per cycle. Runs on in-memory PGlite (tests/setup/db.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

describe("metadata refresh on unknown IDs (Postgres)", async () => {
  const { getDb } = await import("@/db");
  const { importFull } = await import("@/lib/sync/import");
  const { MapKv } = await import("@/lib/sync/poll");
  const { PostgresStore } = await import("@/lib/sync/store-postgres");
  const { refreshUnknownMetadata } = await import("@/lib/sync/trigger");
  const { fixtureSnapshot } = await import("../fixtures/github");

  const snap = fixtureSnapshot();
  const q = async (text: string) => (await getDb().execute(sql.raw(text))).rows as Record<string, unknown>[];
  const meta = (labels = snap.labels) => ({ projectId: snap.projectId, fields: snap.fields, issueTypes: snap.issueTypes, labels, milestones: snap.milestones });
  const source = (labels = snap.labels) => ({ fetchMetadata: vi.fn(async () => meta(labels)) });
  /** What a poll does with a label the cache has no row for: the link holds the bare name. */
  const link = (label: string) => q(`INSERT INTO issue_labels (issue_id, label_id) SELECT id, '${label}' FROM issues WHERE gh_node_id = 'I_epic'`);

  beforeEach(async () => {
    await q(`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, tasks, task_links RESTART IDENTITY CASCADE`);
    await importFull(fixtureSnapshot(), new PostgresStore());
  });

  it("nothing unknown: no call to GitHub", async () => {
    const src = source();
    expect(await refreshUnknownMetadata(src, new PostgresStore(), new MapKv())).toBe(false);
    expect(src.fetchMetadata).not.toHaveBeenCalled();
  });

  it("a new label gets its row and the link its real ID in the same run", async () => {
    await link("fresh");
    const src = source([...snap.labels, { id: "LA_fresh", name: "fresh", color: "ededed", description: "" }]);
    const kv = new MapKv();
    expect(await refreshUnknownMetadata(src, new PostgresStore(), kv)).toBe(true);
    expect(await q(`SELECT name FROM labels WHERE id = 'LA_fresh'`)).toEqual([{ name: "fresh" }]);
    expect(await q(`SELECT label_id FROM issue_labels WHERE label_id IN ('fresh', 'LA_fresh')`)).toEqual([{ label_id: "LA_fresh" }]);
    // Resolved: the next cycle has nothing to ask.
    expect(await refreshUnknownMetadata(src, new PostgresStore(), kv)).toBe(false);
    expect(src.fetchMetadata).toHaveBeenCalledTimes(1);
  });

  it("an ID the metadata never explains is fetched for once, then left to the reconcile", async () => {
    await link("deleted-on-github");
    const src = source();
    const kv = new MapKv();
    expect(await refreshUnknownMetadata(src, new PostgresStore(), kv)).toBe(true);
    expect(await refreshUnknownMetadata(src, new PostgresStore(), kv)).toBe(false);
    expect(src.fetchMetadata).toHaveBeenCalledTimes(1);
    // Another unknown one is a new reason to look.
    await link("second");
    expect(await refreshUnknownMetadata(src, new PostgresStore(), kv)).toBe(true);
    expect(src.fetchMetadata).toHaveBeenCalledTimes(2);
  });

  it("an unknown option on a project item counts too", async () => {
    await q(`INSERT INTO project_item_dims (item_id, field_id, option_id) SELECT id, 'F_new', 'opt_new' FROM project_items LIMIT 1`);
    const src = source();
    expect(await refreshUnknownMetadata(src, new PostgresStore(), new MapKv())).toBe(true);
  });

  it("right after the reconcile read the metadata, nothing is fetched twice", async () => {
    await link("deleted-on-github");
    const src = source();
    const kv = new MapKv();
    expect(await refreshUnknownMetadata(src, new PostgresStore(), kv, { fetched: true })).toBe(false);
    expect(await refreshUnknownMetadata(src, new PostgresStore(), kv)).toBe(false);
    expect(src.fetchMetadata).not.toHaveBeenCalled();
  });

  it("a failed fetch does not fail the cycle, and is tried again", async () => {
    await link("fresh");
    const src = { fetchMetadata: vi.fn(async () => { throw new Error("boom"); }) };
    const kv = new MapKv();
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await refreshUnknownMetadata(src, new PostgresStore(), kv)).toBe(false);
      expect(await refreshUnknownMetadata(src, new PostgresStore(), kv)).toBe(false);
      expect(src.fetchMetadata).toHaveBeenCalledTimes(2);
    } finally {
      quiet.mockRestore();
    }
  });
});
