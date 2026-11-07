// D6: migration 0003 drops the pull request tables and clears what local data
// still points at pull requests, so the strict schemas parse every stored row.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { describe, expect, it } from "vitest";
import { resolveSidebar } from "@/lib/tasks/model";
import { viewSchema } from "@/lib/views/view";

const dir = path.join(process.cwd(), "drizzle");
const journal = JSON.parse(readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
const run = async (pg: PGlite, tag: string) => {
  for (const stmt of readFileSync(path.join(dir, `${tag}.sql`), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
};

describe("migration 0003 (D6)", () => {
  it("drops the pull request tables and the local data that points at pull requests", async () => {
    const pg = new PGlite("memory://", { extensions: { pg_trgm } });
    try {
      const before = journal.entries.filter((e) => e.tag < "0003");
      const d6 = journal.entries.find((e) => e.tag.startsWith("0003"))!;
      for (const e of before) await run(pg, e.tag);

      await pg.query(
        `INSERT INTO pull_requests (gh_node_id, number, state, author_login, url, created_at, updated_at, fingerprint) VALUES ('PR_1', 9, 'open', 'bob', 'https://github.com/acme/widgets/pull/9', now(), now(), 'x')`,
      );
      await pg.query(`INSERT INTO gh_team_members (team_slug, login) VALUES ('core', 'alice')`);
      const task = (await pg.query<{ id: string }>(`INSERT INTO tasks (creator_login, title) VALUES ('alice', 'Ship it') RETURNING id`)).rows[0]!.id;
      await pg.query(
        `INSERT INTO task_links (task_id, target_kind, target_node_id, target_number, position) VALUES ($1, 'issue', 'I_1', 1, 0), ($1, 'pr', 'PR_1', 9, 1)`,
        [task],
      );
      const issueView = { id: "v1", name: "Bugs", ownerId: "alice", visibility: "personal", layout: "list", filters: [], sort: [], entity: "issue" };
      const prView = { ...issueView, id: "v2", name: "Merged", entity: "pr", pr: { filters: [], sort: "updated", dir: "desc", groupBy: "", layout: "list" } };
      for (const v of [issueView, prView]) await pg.query(`INSERT INTO views (id, owner_id, name, definition_json) VALUES ($1, 'alice', $2, $3)`, [v.id, v.name, JSON.stringify(v)]);
      const filter = [{ field: "label", op: "in", values: ["L1"] }];
      await pg.query(`INSERT INTO task_projects (owner_login, name, source) VALUES ('alice', 'Both', $1), ('alice', 'PRs only', $2)`, [
        JSON.stringify({ issues: filter, prs: [{ field: "author", values: ["me"] }] }),
        JSON.stringify({ issues: null, prs: [{ field: "author", values: ["me"] }] }),
      ]);
      await pg.query(`INSERT INTO user_prefs (login, sidebar) VALUES ('alice', $1)`, [JSON.stringify({ order: ["pulls", "tasks"], hidden: ["pulls"] })]);
      await pg.query(`INSERT INTO sync_state (key, value) VALUES ('prs.lastScan', '2026-10-01T00:00:00Z')`);

      await run(pg, d6.tag);

      const tables = (await pg.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name);
      for (const t of ["pull_requests", "pr_labels", "pr_assignees", "pr_review_requests", "pr_reviews", "pr_issue_links", "gh_team_members"]) expect(tables).not.toContain(t);

      expect((await pg.query(`SELECT target_kind, target_number FROM task_links ORDER BY position`)).rows).toEqual([{ target_kind: "issue", target_number: 1 }]);

      const views = (await pg.query<{ id: string; definition_json: unknown }>(`SELECT id, definition_json FROM views ORDER BY id`)).rows;
      expect(views.map((v) => v.id)).toEqual(["v1"]);
      expect(viewSchema.safeParse(views[0]!.definition_json).success).toBe(true);

      const sources = (await pg.query<{ name: string; source: unknown }>(`SELECT name, source FROM task_projects ORDER BY name`)).rows;
      expect(sources).toEqual([
        { name: "Both", source: { issues: filter } },
        { name: "PRs only", source: null },
      ]);

      const sidebar = (await pg.query<{ sidebar: { order: string[]; hidden: string[] } }>(`SELECT sidebar FROM user_prefs WHERE login = 'alice'`)).rows[0]!.sidebar;
      expect(sidebar).toEqual({ order: ["tasks"], hidden: [] });
      expect(resolveSidebar(sidebar as never)[0]!.id).toBe("tasks");

      expect((await pg.query(`SELECT key FROM sync_state WHERE key = 'prs.lastScan'`)).rows).toEqual([]);
    } finally {
      await pg.close();
    }
  });
});
