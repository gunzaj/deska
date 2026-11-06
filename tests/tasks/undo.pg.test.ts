// U1 against Postgres: restore brings back exactly one delete; undoing an
// occurrence removes its completion row. Runs on in-memory PGlite (tests/setup/db.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { PostgresTaskRepo, type StoredTask } from "@/lib/tasks/repo";
import { deleteTask, restoreTask, updateTask } from "@/lib/tasks/service";

const anyone = () => true;

function task(p: Partial<StoredTask> = {}): StoredTask {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    creator: "alice",
    assignee: null,
    parentId: null,
    title: "Task",
    description: "",
    priority: 4,
    dueDate: null,
    dueTime: null,
    dueTz: "UTC",
    recurrence: null,
    reminders: [],
    completedAt: null,
    completedBy: null,
    links: [{ kind: "issue", nodeId: "I_x", number: 101 }],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...p,
  };
}

describe("undo (Postgres)", () => {
  const repo = new PostgresTaskRepo();
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE tasks, task_comments, task_completions, task_links, task_labels RESTART IDENTITY CASCADE`);
  });

  it("restores the task, its sub-task and comments from that delete, not an older deleted comment", async () => {
    const parent = task({ title: "Parent" });
    const child = task({ title: "Child", parentId: parent.id, links: [] });
    await repo.insert(parent);
    await repo.insert(child);
    const at = () => new Date().toISOString();
    await repo.insertComment({ id: crypto.randomUUID(), taskId: parent.id, author: "alice", body: "kept", createdAt: at(), updatedAt: at() });
    const old = crypto.randomUUID();
    await repo.insertComment({ id: old, taskId: parent.id, author: "alice", body: "deleted earlier", createdAt: at(), updatedAt: at() });
    await repo.deleteComment(old);

    expect((await deleteTask("alice", parent.id)).ok).toBe(true);
    expect(await repo.getVisible("alice", parent.id)).toBeNull();

    const r = await restoreTask("alice", parent.id);
    expect(r.ok).toBe(true);
    expect((await repo.getVisible("alice", parent.id))?.links.map((l) => l.number)).toEqual([101]);
    expect((await repo.getVisible("alice", child.id))?.title).toBe("Child");
    expect((await repo.comments(parent.id)).map((c) => c.body)).toEqual(["kept"]);
  });

  it("undoing a recurring completion restores the date and drops the completion row", async () => {
    const t = task({ dueDate: "2026-10-16", recurrence: { rule: "FREQ=WEEKLY", text: "every week", fromCompletion: false } });
    await repo.insert(t);
    await updateTask("alice", t.id, { completed: true }, anyone);
    expect((await repo.getVisible("alice", t.id))?.dueDate).toBe("2026-10-23");
    await updateTask("alice", t.id, { undoOccurrence: "2026-10-16" }, anyone);
    expect((await repo.getVisible("alice", t.id))?.dueDate).toBe("2026-10-16");
    const rows = (await getDb().execute(sql`SELECT count(*)::int AS n FROM task_completions WHERE task_id = ${t.id}`)).rows;
    expect(rows[0]!.n).toBe(0);
  });

  it("a refused undo keeps the completion row and the date (v5 1.7)", async () => {
    const t = task({ dueDate: "2026-10-16", recurrence: { rule: "FREQ=WEEKLY", text: "every week", fromCompletion: false } });
    await repo.insert(t);
    await updateTask("alice", t.id, { completed: true }, anyone);
    expect((await repo.getVisible("alice", t.id))?.dueDate).toBe("2026-10-23");
    const rows = async () => Number((await getDb().execute(sql`SELECT count(*)::int AS n FROM task_completions WHERE task_id = ${t.id}`)).rows[0]!.n);
    expect(await rows()).toBe(1);

    // The undo is valid; the project is not. The request is refused as a whole.
    const r = await updateTask("alice", t.id, { undoOccurrence: "2026-10-16", projectId: "00000000-0000-0000-0000-00000000dead" }, anyone);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(await rows()).toBe(1); // the completion row is still there
    expect((await repo.getVisible("alice", t.id))?.dueDate).toBe("2026-10-23"); // and the date did not move back
  });

  it("a write after a refusal point is rolled back with the refusal, whatever the order (v5 1.7)", async () => {
    // Any `{ ok: false }` result from inside the lock rolls everything back.
    const t = task({ recurrence: null });
    await repo.insert(t);
    const out = await repo.locked(t.id, async () => {
      await repo.update(t.id, { title: "Changed then refused" });
      return { ok: false as const, status: 400, error: "refused" };
    });
    expect(out).toMatchObject({ ok: false, status: 400 });
    expect((await repo.getVisible("alice", t.id))?.title).toBe("Task");
  });

  it("createTask is one transaction: a failing ensureLabels leaves no task behind (v5 1.7)", async () => {
    const { createTask } = await import("@/lib/tasks/service");
    const spy = vi.spyOn(PostgresTaskRepo.prototype, "insertLabel").mockRejectedValueOnce(new Error("label table down"));
    try {
      await expect(
        createTask("alice", { title: "Ship it", labels: ["urgent"], links: [], reminders: [], priority: 4, projectId: null, parentId: null, assignee: null, description: "", dueDate: null, dueTime: null, recurrence: null } as never, anyone),
      ).rejects.toThrow("label table down");
    } finally {
      spy.mockRestore();
    }
    expect((await getDb().execute(sql`SELECT count(*)::int AS n FROM tasks`)).rows[0]!.n).toBe(0);
  });
});
