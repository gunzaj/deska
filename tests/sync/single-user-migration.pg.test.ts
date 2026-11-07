// D7: migration 0004 makes every local record belong to this install. It runs
// on data written by a multi-user build: assignees, per-login placements,
// labels, projects, snoozes, watches and settings, with names and keys that
// would collide once the owners merge.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { describe, expect, it } from "vitest";
import { LOCAL_OWNER } from "@/lib/local-owner";
import { viewSchema } from "@/lib/views/view";

const dir = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
const run = async (pg: PGlite, tag: string) => {
  for (const stmt of readFileSync(path.join(dir, `${tag}.sql`), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
};
const rows = async <T>(pg: PGlite, q: string, params: unknown[] = []) => (await pg.query<T>(q, params)).rows;

describe("migration 0004 (D7)", () => {
  it("collapses every owner key to the local owner without losing or colliding rows", async () => {
    const pg = new PGlite("memory://", { extensions: { pg_trgm } });
    try {
      const d7 = journal.entries.find((e) => e.tag.startsWith("0004"))!;
      for (const e of journal.entries.filter((e) => e.tag < "0004")) await run(pg, e.tag);

      // A task alice delegated to bob, and one bob made.
      const delegated = (await rows<{ id: string }>(pg, `INSERT INTO tasks (creator_login, assignee_login, title, completed_by, completed_at) VALUES ('alice', 'bob', 'Delegated', 'bob', now()) RETURNING id`))[0]!.id;
      const bobs = (await rows<{ id: string }>(pg, `INSERT INTO tasks (creator_login, title) VALUES ('bob', 'Bobs') RETURNING id`))[0]!.id;
      // Both filed the delegated task, in projects that share a name.
      const pa = (await rows<{ id: string }>(pg, `INSERT INTO task_projects (owner_login, name, position) VALUES ('alice', 'Specs', 1) RETURNING id`))[0]!.id;
      const pb = (await rows<{ id: string }>(pg, `INSERT INTO task_projects (owner_login, name, position) VALUES ('bob', 'specs', 2) RETURNING id`))[0]!.id;
      await pg.query(`INSERT INTO task_placements (task_id, login, project_id, position) VALUES ($1, 'alice', $2, 1), ($1, 'bob', $3, 7)`, [delegated, pa, pb]);
      await pg.query(`INSERT INTO task_labels (owner_login, name) VALUES ('alice', 'Urgent'), ('bob', 'urgent'), ('bob', 'later')`);
      await pg.query(`INSERT INTO task_comments (task_id, author_login, body) VALUES ($1, 'bob', 'note')`, [delegated]);
      await pg.query(`INSERT INTO task_completions (task_id, login, due_date) VALUES ($1, 'bob', '2026-10-01')`, [delegated]);
      await pg.query(`INSERT INTO notifications (login, kind, task_id, actor_login, title, dedupe_key) VALUES
        ('bob', 'assigned', $1, 'alice', 'Delegated', 'a1'), ('alice', 'completed', $1, 'bob', 'Delegated', 'a2'), ('bob', 'comment', $1, 'alice', 'Delegated', 'a3'),
        ('alice', 'reminder', $2, NULL, 'Bobs', 'rem:1'), ('bob', 'watch_digest', NULL, NULL, '1 watched item changed', 'watch:bob:2026-10-01')`, [delegated, bobs]);
      await pg.query(`INSERT INTO triage_snoozes (login, issue_node_id, until) VALUES ('alice', 'I_1', '2026-10-05'), ('bob', 'I_1', '2026-10-20'), ('bob', 'I_2', '2026-10-09')`);
      await pg.query(`INSERT INTO watches (login, kind, target_id, last_seen_at) VALUES ('alice', 'issue', 'I_1', '2026-10-01'), ('bob', 'issue', 'I_1', '2026-09-01'), ('bob', 'view', 'v1', now())`);
      await pg.query(`INSERT INTO sync_state (key, value) VALUES ('github.login', 'bob')`);
      await pg.query(`INSERT INTO user_prefs (login, tz) VALUES ('alice', 'Europe/Prague'), ('bob', 'America/New_York')`);
      const view = { id: "v1", name: "Bugs", ownerId: "bob", visibility: "shared", layout: "list", filters: [], sort: [] };
      await pg.query(`INSERT INTO views (id, owner_id, name, visibility, definition_json) VALUES ('v1', 'bob', 'Bugs', 'shared', $1)`, [JSON.stringify(view)]);

      await run(pg, d7.tag);

      // Every key is the local owner; no task was lost.
      for (const [table, col] of [["tasks", "creator_login"], ["task_projects", "owner_login"], ["task_labels", "owner_login"], ["task_placements", "login"], ["task_comments", "author_login"], ["task_completions", "login"], ["notifications", "login"], ["triage_snoozes", "login"], ["watches", "login"], ["user_prefs", "login"]] as const) {
        const keys = (await rows<{ k: string }>(pg, `SELECT DISTINCT ${col} AS k FROM ${table}`)).map((r) => r.k);
        expect(keys, table).toEqual([LOCAL_OWNER]);
      }
      expect((await rows(pg, `SELECT id FROM tasks`)).length).toBe(2);
      expect((await rows<{ completed_by: string | null }>(pg, `SELECT completed_by FROM tasks WHERE id = $1`, [delegated]))[0]!.completed_by).toBe(LOCAL_OWNER);

      // Same-name projects and labels both survive, the later one renamed.
      const projects = (await rows<{ id: string; name: string }>(pg, `SELECT id, name FROM task_projects ORDER BY position`));
      expect(projects[0]).toMatchObject({ id: pa, name: "Specs" });
      expect(projects[1]!.id).toBe(pb);
      expect(projects[1]!.name).not.toBe("specs");
      expect(projects[1]!.name.startsWith("specs (")).toBe(true);
      // Which of the two same-name labels is renamed depends on their random IDs: exactly one is.
      const labels = (await rows<{ name: string }>(pg, `SELECT name FROM task_labels`)).map((r) => r.name);
      expect(labels).toContain("later");
      expect(labels.filter((n) => n.toLowerCase() === "urgent")).toHaveLength(1);
      expect(labels.filter((n) => /^urgent \(/i.test(n))).toHaveLength(1);
      expect((await rows(pg, `SELECT 1 FROM task_labels`)).length).toBe(3);

      // One placement per task: the creator's.
      expect(await rows(pg, `SELECT project_id, position FROM task_placements WHERE task_id = $1`, [delegated])).toEqual([{ project_id: pa, position: 1 }]);

      // Only reminders and the watchlist digest remain.
      expect((await rows<{ kind: string }>(pg, `SELECT kind FROM notifications ORDER BY kind`)).map((r) => r.kind)).toEqual(["reminder", "watch_digest"]);

      // Snoozes keep the latest date per issue; watches keep the oldest last look; prefs keep the connected account's.
      expect(await rows(pg, `SELECT issue_node_id, until::text AS until FROM triage_snoozes ORDER BY issue_node_id`)).toEqual([
        { issue_node_id: "I_1", until: "2026-10-20" },
        { issue_node_id: "I_2", until: "2026-10-09" },
      ]);
      expect((await rows<{ target_id: string }>(pg, `SELECT target_id FROM watches ORDER BY target_id`)).map((r) => r.target_id)).toEqual(["I_1", "v1"]);
      expect(new Date((await rows<{ t: string }>(pg, `SELECT last_seen_at::text AS t FROM watches WHERE target_id = 'I_1'`))[0]!.t).getUTCMonth()).toBe(8); // September
      expect(await rows(pg, `SELECT tz FROM user_prefs`)).toEqual([{ tz: "America/New_York" }]);

      // Schema: no assignee, owner, visibility, actor or users table left; the view parses.
      const columns = (await rows<{ table_name: string; column_name: string }>(pg, `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`)).map((r) => `${r.table_name}.${r.column_name}`);
      for (const gone of ["tasks.assignee_login", "views.owner_id", "views.visibility", "notifications.actor_login"]) expect(columns).not.toContain(gone);
      expect((await rows<{ table_name: string }>(pg, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map((r) => r.table_name)).not.toContain("users");
      const stored = (await rows<{ definition_json: unknown }>(pg, `SELECT definition_json FROM views`))[0]!.definition_json;
      expect(viewSchema.safeParse(stored).success).toBe(true);
    } finally {
      await pg.close();
    }
  });
});
