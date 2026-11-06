// S9 against Postgres: updateTask runs under the row lock in one transaction.
// Skipped unless TEST_DATABASE_URL points at a throwaway, migrated database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { PostgresTaskRepo, type StoredTask } from "@/lib/tasks/repo";
import { updateTask } from "@/lib/tasks/service";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const anyone = () => true;

function task(p: Partial<StoredTask> = {}): StoredTask {
  const now = new Date("2026-10-13T08:00:00Z").toISOString();
  return {
    id: crypto.randomUUID(),
    creator: "alice",
    assignee: null,
    parentId: null,
    title: "Weekly report",
    description: "",
    priority: 4,
    dueDate: "2026-10-16",
    dueTime: null,
    dueTz: "UTC",
    recurrence: { rule: "FREQ=WEEKLY", text: "every week", fromCompletion: false },
    reminders: [],
    completedAt: null,
    completedBy: null,
    links: [],
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...p,
  };
}

suite("safe task updates (Postgres)", () => {
  const repo = new PostgresTaskRepo();
  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });
  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE tasks, task_completions, notifications RESTART IDENTITY CASCADE`);
  });
  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  const completions = async (id: string) => (await getDb().execute(sql`SELECT due_date::text AS d FROM task_completions WHERE task_id = ${id}`)).rows.map((r) => r.d);

  it("two concurrent completes of a recurring task: one completion row, one date move", async () => {
    const t = task();
    await repo.insert(t);
    const patch = { completed: true, expectedUpdatedAt: t.updatedAt };
    const [a, b] = await Promise.all([updateTask("alice", t.id, patch, anyone), updateTask("alice", t.id, patch, anyone)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const refused = [a, b].find((r) => !r.ok)!;
    expect(refused).toMatchObject({ ok: false, status: 409 });
    expect(await completions(t.id)).toEqual(["2026-10-16"]);
    expect((await repo.getVisible("alice", t.id))?.dueDate).toBe("2026-10-23");
  });

  it("an occurrence already logged is not logged again and the date doesn't move twice", async () => {
    const t = task();
    await repo.insert(t);
    // A second request that slipped past the version check (no expectedUpdatedAt)
    // but saw the same occurrence: the unique index stops the second move.
    await getDb().execute(sql`INSERT INTO task_completions (task_id, login, due_date) VALUES (${t.id}, 'alice', '2026-10-16')`);
    const r = await updateTask("alice", t.id, { completed: true }, anyone);
    expect(r.ok).toBe(true);
    expect(await completions(t.id)).toEqual(["2026-10-16"]);
    expect((await repo.getVisible("alice", t.id))?.dueDate).toBe("2026-10-16");
  });

  it("a stale updatedAt returns 409 with the current task and writes nothing", async () => {
    const t = task({ recurrence: null });
    await repo.insert(t);
    const ok = await updateTask("alice", t.id, { title: "Renamed", expectedUpdatedAt: t.updatedAt }, anyone);
    expect(ok.ok).toBe(true);
    const stale = await updateTask("alice", t.id, { title: "Mine", expectedUpdatedAt: t.updatedAt }, anyone);
    expect(stale).toMatchObject({ ok: false, status: 409, current: { title: "Renamed" } });
    expect((await repo.getVisible("alice", t.id))?.title).toBe("Renamed");
  });

  it("filing changes are never refused", async () => {
    const t = task({ recurrence: null });
    await repo.insert(t);
    await updateTask("alice", t.id, { title: "Renamed" }, anyone);
    expect((await updateTask("alice", t.id, { position: 3, expectedUpdatedAt: t.updatedAt }, anyone)).ok).toBe(true);
  });

  it("a failed update rolls back every write in it", async () => {
    const t = task({ recurrence: null });
    await repo.insert(t);
    // Unknown project: refused after the lock, nothing written.
    const r = await updateTask("alice", t.id, { title: "Nope", projectId: "00000000-0000-0000-0000-00000000dead" }, anyone);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect((await repo.getVisible("alice", t.id))?.title).toBe("Weekly report");
  });
});
