// S7 against Postgres: the baseline's foreign keys, cascades, one
// project item per issue, and a store that survives a cache rebuild.
// Skipped unless TEST_DATABASE_URL points at a throwaway Postgres.
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { projectItems } from "@/db/schema";
import { importFull } from "@/lib/sync/import";
import { MapKv, pollOnce } from "@/lib/sync/poll";
import { PostgresStore, readSnapshot } from "@/lib/sync/store-postgres";
import type { SnapshotProjectItem } from "@/lib/sync/types";
import { fixtureSnapshot } from "../fixtures/github";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const MIGRATIONS = join(process.cwd(), "drizzle");

const ORPHAN_CHECK = sql`
  SELECT
    (SELECT count(*) FROM issue_labels c WHERE NOT EXISTS (SELECT 1 FROM issues p WHERE p.id = c.issue_id))
  + (SELECT count(*) FROM issue_assignees c WHERE NOT EXISTS (SELECT 1 FROM issues p WHERE p.id = c.issue_id))
  + (SELECT count(*) FROM project_items c WHERE NOT EXISTS (SELECT 1 FROM issues p WHERE p.id = c.issue_id))
  + (SELECT count(*) FROM pr_labels c WHERE NOT EXISTS (SELECT 1 FROM pull_requests p WHERE p.id = c.pr_id))
  + (SELECT count(*) FROM pr_reviews c WHERE NOT EXISTS (SELECT 1 FROM pull_requests p WHERE p.id = c.pr_id))
  + (SELECT count(*) FROM task_links c WHERE NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = c.task_id))
  + (SELECT count(*) FROM task_placements c WHERE NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = c.task_id))
  + (SELECT count(*) FROM notifications c WHERE NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = c.task_id))
  + (SELECT count(*) FROM task_comments c WHERE NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = c.task_id))
  AS n`;

suite("schema integrity (Postgres)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });
  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  it("the baseline migration creates the extension, foreign keys and case-insensitive label uniqueness", async () => {
    const name = `deska_mig_${Date.now().toString(36)}`;
    const admin = new Pool({ connectionString: url });
    await admin.query(`CREATE DATABASE ${name}`);
    const target = new URL(url!);
    target.pathname = `/${name}`;
    const pool = new Pool({ connectionString: target.toString() });
    // DROP DATABASE … WITH (FORCE) below terminates any connection still
    // closing; that must not surface as an uncaught pool error.
    pool.on("error", () => {});
    try {
      const db = drizzle(pool);
      await migrate(db, { migrationsFolder: MIGRATIONS });

      const ext = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`);
      expect(ext.rowCount).toBe(1);
      expect(Number((await db.execute(ORPHAN_CHECK)).rows[0]!.n)).toBe(0);
      await expect(pool.query(`INSERT INTO issue_labels (issue_id, label_id) VALUES ('10000000-0000-0000-0000-0000000000aa', 'L1')`)).rejects.toThrow(/foreign key/);
      await pool.query(`INSERT INTO labels (id, name) VALUES ('L_dup', 'Bug')`);
      await expect(pool.query(`INSERT INTO labels (id, name) VALUES ('L_x', 'BUG')`)).rejects.toThrow(/duplicate key/);
    } finally {
      await pool.end().catch(() => {});
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  });

  describe("on the test database", () => {
    beforeEach(async () => {
      await getDb().execute(
        sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, pull_requests, pr_labels, pr_assignees, pr_review_requests, pr_reviews, pr_issue_links, gh_team_members, tasks, task_projects RESTART IDENTITY CASCADE`,
      );
    });

    it("deleting a task removes its placements, links, reminders, comments and notifications, but keeps completions (in the DB)", async () => {
      const db = getDb();
      const t = "40000000-0000-0000-0000-000000000001";
      await db.execute(sql`INSERT INTO tasks (id, creator_login, title) VALUES (${t}, 'alice', 'Parent')`);
      await db.execute(sql`INSERT INTO tasks (id, creator_login, title, parent_id) VALUES ('40000000-0000-0000-0000-000000000002', 'alice', 'Child', ${t})`);
      await db.execute(sql`INSERT INTO task_placements (task_id, login) VALUES (${t}, 'alice')`);
      await db.execute(sql`INSERT INTO task_links (task_id, target_kind, target_node_id, target_number) VALUES (${t}, 'issue', 'I_x', 9)`);
      await db.execute(sql`INSERT INTO task_reminders (task_id, kind, offset_min) VALUES (${t}, 'relative', 30)`);
      await db.execute(sql`INSERT INTO task_comments (task_id, author_login, body) VALUES (${t}, 'alice', 'note')`);
      await db.execute(sql`INSERT INTO notifications (login, kind, task_id, title, dedupe_key) VALUES ('alice', 'reminder', ${t}, 'Parent', 'dk-1')`);
      await db.execute(sql`INSERT INTO task_completions (task_id, login) VALUES (${t}, 'alice')`);

      await db.execute(sql`DELETE FROM tasks WHERE id = ${t}`);

      const { rows } = await db.execute(sql`
        SELECT (SELECT count(*) FROM tasks) + (SELECT count(*) FROM task_placements) + (SELECT count(*) FROM task_links)
             + (SELECT count(*) FROM task_reminders) + (SELECT count(*) FROM task_comments) + (SELECT count(*) FROM notifications) AS n`);
      expect(Number(rows[0]!.n)).toBe(0);
      // Completions are kept (SPEC §12.1): SET NULL, not cascade.
      const kept = await db.execute(sql`SELECT task_id FROM task_completions`);
      expect(kept.rows).toHaveLength(1);
      expect(kept.rows[0]!.task_id).toBeNull();
    });

    it("rebuild: issues truncated under a live store, a cycle leaves no child row pointing at a missing issue", async () => {
      const store = new PostgresStore();
      await importFull(fixtureSnapshot(), store);
      await getDb().execute(sql`TRUNCATE issues CASCADE`);
      const snap = fixtureSnapshot();
      const kv = new MapKv();
      kv.set("issues.since", "2026-10-01T00:00:00Z");
      await pollOnce({ checkChanges: async () => ({ kind: "changed", issues: snap.issues, items: snap.projectItems, etag: "e", since: "2026-10-13T00:00:00Z" }) }, store, kv, "2026-10-13T00:00:00Z");
      expect(Number((await getDb().execute(ORPHAN_CHECK)).rows[0]!.n)).toBe(0);
      const read = await readSnapshot();
      expect(read.issues.find((i) => i.nodeId === "I_epic")?.labelIds).toEqual(["LA_1"]);
      // The row-level path can't write against a stale ID either.
      await expect(store.setIssueLabels("I_gone", ["LA_1"])).rejects.toThrow(/missing/);
    });

    it("keeps one project item per issue: the most recently updated", async () => {
      const store = new PostgresStore();
      await importFull({ ...fixtureSnapshot(), projectItems: [] }, store);
      const item = (itemId: string, updatedAt: string | null, statusOpt: string): SnapshotProjectItem => ({
        itemId,
        issueNodeId: "I_bug",
        statusOpt,
        priorityOpt: null,
        teamOpt: null,
        platformOpt: null,
        releaseIter: null,
        updatedAt,
      });
      const items = async () => (await getDb().select({ id: projectItems.ghItemId, status: projectItems.statusOpt }).from(projectItems)).map((r) => `${r.id}:${r.status}`);
      // Two in one page: the newer wins.
      await importFull({ ...fixtureSnapshot(), issues: [], pullRequests: [], projectItems: [item("PVTI_a", "2026-10-01T00:00:00Z", "a0000001"), item("PVTI_b", "2026-10-05T00:00:00Z", "a0000002")] }, store);
      expect(await items()).toEqual(["PVTI_b:a0000002"]);
      // An older one later is ignored; a newer one replaces the stored item.
      await importFull({ ...fixtureSnapshot(), issues: [], pullRequests: [], projectItems: [item("PVTI_c", "2026-09-01T00:00:00Z", "a0000001")] }, store);
      expect(await items()).toEqual(["PVTI_b:a0000002"]);
      await importFull({ ...fixtureSnapshot(), issues: [], pullRequests: [], projectItems: [item("PVTI_d", "2026-10-10T00:00:00Z", "a0000006")] }, store);
      expect(await items()).toEqual(["PVTI_d:a0000006"]);
    });

    it("labels are unique by lower(name); a case variant re-keys onto the real ID", async () => {
      const store = new PostgresStore();
      await importFull(fixtureSnapshot(), store);
      await store.upsertLabel({ id: "LA_ui2", name: "ui", color: "", description: "" });
      const read = await readSnapshot();
      expect(read.labels.filter((l) => l.name.toLowerCase() === "ui").map((l) => l.id)).toEqual(["LA_ui2"]);
      expect(read.issues.find((i) => i.nodeId === "I_epic")?.labelIds).toEqual(["LA_ui2"]);
    });
  });
});
