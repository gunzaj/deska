// F6 digest against Postgres: a notification with no task (task_id is nullable now).
// Skipped unless TEST_DATABASE_URL points at a throwaway, migrated database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { PostgresTaskRepo, type StoredTask } from "@/lib/tasks/repo";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("watch digest notifications (Postgres)", () => {
  const repo = new PostgresTaskRepo();
  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE tasks, notifications RESTART IDENTITY CASCADE`);
  });
  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  it("stores and lists a digest without a task, dedupes it, and still hides tasks the viewer can't open", async () => {
    const now = new Date().toISOString();
    const mine: StoredTask = { id: crypto.randomUUID(), creator: "alice", assignee: null, parentId: null, title: "mine", description: "", priority: 4, dueDate: null, dueTime: null, dueTz: null, recurrence: null, reminders: [], completedAt: null, completedBy: null, links: [], createdAt: now, updatedAt: now, deletedAt: null };
    const theirs = { ...mine, id: crypto.randomUUID(), creator: "bob", title: "theirs" };
    await repo.insert(mine);
    await repo.insert(theirs);
    expect(await repo.addNotification({ login: "alice", kind: "watch_digest", taskId: null, actor: null, title: "2 watched items changed", dedupeKey: "watch:alice:2026-10-13" })).toBe(true);
    expect(await repo.addNotification({ login: "alice", kind: "watch_digest", taskId: null, actor: null, title: "again", dedupeKey: "watch:alice:2026-10-13" })).toBe(false);
    await repo.addNotification({ login: "alice", kind: "comment", taskId: mine.id, actor: "bob", title: "mine", dedupeKey: "c1" });
    // A notification for a task alice can't see (stale): stays out.
    await repo.addNotification({ login: "alice", kind: "comment", taskId: theirs.id, actor: "bob", title: "theirs", dedupeKey: "c2" });
    const { list, unread } = await repo.notifications("alice", 50);
    expect(list.map((n) => [n.kind, n.taskId, n.title]).sort()).toEqual([
      ["comment", mine.id, "mine"],
      ["watch_digest", null, "2 watched items changed"],
    ]);
    expect(unread).toBe(2);
    // Deleting the task takes its notifications with it; the digest stays.
    await repo.deleteNotificationsForTask(mine.id);
    expect((await repo.notifications("alice", 50)).list.map((n) => n.kind)).toEqual(["watch_digest"]);
  });
});
