// S8 against Postgres: one test per retention rule, rows on both sides of
// each cut-off. Runs on in-memory PGlite (tests/setup/db.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { runRetention } from "@/lib/maintenance/retention";
import { PostgresTaskRepo } from "@/lib/tasks/repo";

const NOW = new Date("2026-10-13T03:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const count = async (table: string) => Number((await getDb().execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))).rows[0]!.n);

describe("retention (Postgres)", () => {
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE tasks, task_comments, notifications, audit_log, task_completions, issues, issue_field_changes RESTART IDENTITY CASCADE`);
    await getDb().execute(sql`INSERT INTO tasks (id, creator_login, title) VALUES ('50000000-0000-0000-0000-000000000001', 'alice', 'Live')`);
  });

  it("notifications: read ones after 90 days, unread ones after 180", async () => {
    const t = "50000000-0000-0000-0000-000000000001";
    const add = (key: string, created: string, read: string | null) =>
      getDb().execute(sql`INSERT INTO notifications (login, kind, task_id, title, dedupe_key, created_at, read_at) VALUES ('alice', 'reminder', ${t}, 'x', ${key}, ${created}, ${read})`);
    await add("read-old", daysAgo(91), daysAgo(80));
    await add("read-new", daysAgo(89), daysAgo(80));
    await add("unread-old", daysAgo(181), null);
    await add("unread-mid", daysAgo(120), null);
    const res = await runRetention(NOW);
    expect(res).toMatchObject({ notificationsRead: 1, notificationsUnread: 1 });
    const left = (await getDb().execute(sql`SELECT dedupe_key FROM notifications ORDER BY dedupe_key`)).rows.map((r) => r.dedupe_key);
    expect(left).toEqual(["read-new", "unread-mid"]);
  });

  it("soft-deleted tasks and comments: hard-deleted after 30 days, with the task's rows", async () => {
    await getDb().execute(sql`INSERT INTO tasks (id, creator_login, title, deleted_at) VALUES
      ('50000000-0000-0000-0000-000000000002', 'alice', 'Deleted long ago', ${daysAgo(31)}),
      ('50000000-0000-0000-0000-000000000003', 'alice', 'Deleted recently', ${daysAgo(10)})`);
    await getDb().execute(sql`INSERT INTO task_placements (task_id, login) VALUES ('50000000-0000-0000-0000-000000000002', 'alice')`);
    await getDb().execute(sql`INSERT INTO task_comments (task_id, author_login, body, deleted_at) VALUES
      ('50000000-0000-0000-0000-000000000001', 'alice', 'old deleted', ${daysAgo(31)}),
      ('50000000-0000-0000-0000-000000000001', 'alice', 'new deleted', ${daysAgo(29)}),
      ('50000000-0000-0000-0000-000000000001', 'alice', 'kept', NULL)`);
    const res = await runRetention(NOW);
    expect(res).toMatchObject({ tasks: 1, comments: 1 });
    expect((await getDb().execute(sql`SELECT title FROM tasks ORDER BY title`)).rows.map((r) => r.title)).toEqual(["Deleted recently", "Live"]);
    expect(await count("task_placements")).toBe(0);
    expect((await getDb().execute(sql`SELECT body FROM task_comments ORDER BY body`)).rows.map((r) => r.body)).toEqual(["kept", "new deleted"]);
  });

  it("a task deleted inside the 30 days is still found by the undo path", async () => {
    await getDb().execute(sql`INSERT INTO tasks (id, creator_login, title, deleted_at) VALUES ('50000000-0000-0000-0000-000000000004', 'alice', 'Undo me', ${daysAgo(29)})`);
    await runRetention(NOW);
    const repo = new PostgresTaskRepo();
    expect((await repo.getDeleted("50000000-0000-0000-0000-000000000004"))?.title).toBe("Undo me");
    // Not once it is past the window.
    await runRetention(new Date(NOW.getTime() + 2 * 86_400_000));
    expect(await repo.getDeleted("50000000-0000-0000-0000-000000000004")).toBeNull();
  });

  it("soft-deleted views go after 30 days", async () => {
    await getDb().execute(sql`DELETE FROM views WHERE id LIKE 'ret-%'`);
    await getDb().execute(sql`INSERT INTO views (id, name, definition_json, deleted_at) VALUES
      ('ret-old', 'Old', '{}', ${daysAgo(31)}),
      ('ret-new', 'New', '{}', ${daysAgo(29)}),
      ('ret-live', 'Live', '{}', NULL)`);
    const res = await runRetention(NOW);
    expect(res.views).toBe(1);
    expect((await getDb().execute(sql`SELECT id FROM views WHERE id LIKE 'ret-%' ORDER BY id`)).rows.map((r) => r.id)).toEqual(["ret-live", "ret-new"]);
  });

  it("audit_log keeps one year; task_completions are kept", async () => {
    await getDb().execute(sql`INSERT INTO audit_log (field, at) VALUES ('old', ${daysAgo(366)}), ('new', ${daysAgo(364)})`);
    await getDb().execute(sql`INSERT INTO task_completions (task_id, login, at) VALUES ('50000000-0000-0000-0000-000000000001', 'alice', ${daysAgo(2000)})`);
    const res = await runRetention(NOW);
    expect(res.audit).toBe(1);
    expect((await getDb().execute(sql`SELECT field FROM audit_log`)).rows.map((r) => r.field)).toEqual(["new"]);
    expect(await count("task_completions")).toBe(1);
  });

  it("hard-deleting a task keeps its completions (SET NULL, not cascade)", async () => {
    await getDb().execute(sql`INSERT INTO tasks (id, creator_login, title, deleted_at) VALUES ('50000000-0000-0000-0000-000000000009', 'alice', 'Old recurring', ${daysAgo(31)})`);
    await getDb().execute(sql`INSERT INTO task_completions (task_id, login, at) VALUES ('50000000-0000-0000-0000-000000000009', 'alice', ${daysAgo(40)})`);
    const res = await runRetention(NOW);
    expect(res.tasks).toBe(1);
    const rows = (await getDb().execute(sql`SELECT task_id FROM task_completions`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.task_id).toBeNull();
  });

  it("field changes keep 13 months (395 days)", async () => {
    await getDb().execute(sql`INSERT INTO issues (id, gh_node_id, number) VALUES ('60000000-0000-0000-0000-000000000001', 'I_ret', 1)`);
    await getDb().execute(
      sql`INSERT INTO issue_field_changes (issue_id, field, new_value, observed_at) VALUES ('60000000-0000-0000-0000-000000000001', 'old', 'x', ${daysAgo(396)}), ('60000000-0000-0000-0000-000000000001', 'new', 'x', ${daysAgo(394)})`,
    );
    const res = await runRetention(NOW);
    expect(res.fieldChanges).toBe(1);
    expect((await getDb().execute(sql`SELECT field FROM issue_field_changes`)).rows.map((r) => r.field)).toEqual(["new"]);
  });
});
