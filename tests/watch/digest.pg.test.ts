// F6 digest against Postgres: a notification with no task (task_id is nullable now).
// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { PostgresTaskRepo, type StoredTask } from "@/lib/tasks/repo";

describe("watch digest notifications (Postgres)", () => {
  const repo = new PostgresTaskRepo();
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE tasks, notifications RESTART IDENTITY CASCADE`);
  });

  it("stores and lists a digest without a task and dedupes it; a deleted task's notification stays out", async () => {
    const now = new Date().toISOString();
    const mine: StoredTask = { id: crypto.randomUUID(), creator: "alice", parentId: null, title: "mine", description: "", priority: 4, dueDate: null, dueTime: null, dueTz: null, recurrence: null, reminders: [], completedAt: null, completedBy: null, links: [], createdAt: now, updatedAt: now, deletedAt: null };
    const theirs = { ...mine, id: crypto.randomUUID(), title: "theirs", deletedAt: now };
    await repo.insert(mine);
    await repo.insert(theirs);
    expect(await repo.addNotification({ login: "alice", kind: "watch_digest", taskId: null, title: "2 watched items changed", dedupeKey: "watch:alice:2026-10-13" })).toBe(true);
    expect(await repo.addNotification({ login: "alice", kind: "watch_digest", taskId: null, title: "again", dedupeKey: "watch:alice:2026-10-13" })).toBe(false);
    await repo.addNotification({ login: "alice", kind: "reminder", taskId: mine.id, title: "mine", dedupeKey: "c1" });
    // A notification for a deleted task (stale): stays out.
    await repo.addNotification({ login: "alice", kind: "reminder", taskId: theirs.id, title: "theirs", dedupeKey: "c2" });
    const { list, unread } = await repo.notifications("alice", 50);
    expect(list.map((n) => [n.kind, n.taskId, n.title]).sort()).toEqual([
      ["reminder", mine.id, "mine"],
      ["watch_digest", null, "2 watched items changed"],
    ]);
    expect(unread).toBe(2);
    // Deleting the task takes its notifications with it; the digest stays.
    await repo.deleteNotificationsForTask(mine.id);
    expect((await repo.notifications("alice", 50)).list.map((n) => n.kind)).toEqual(["watch_digest"]);
  });
});
