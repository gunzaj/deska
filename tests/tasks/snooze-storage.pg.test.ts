// A snoozed reminder keeps its `snooze` mark through PostgresTaskRepo and is a
// reminder candidate like any absolute one. PGlite (tests/setup/db.ts).
import { describe, expect, it } from "vitest";
import { PostgresTaskRepo, type StoredTask } from "@/lib/tasks/repo";

function row(p: Partial<StoredTask>): StoredTask {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), creator: "sz", parentId: null, sectionId: null, title: "t", description: "", priority: 4,
    dueDate: null, dueTime: null, dueTz: null, recurrence: null, reminders: [], completedAt: null, completedBy: null,
    links: [], createdAt: now, updatedAt: now, deletedAt: null, ...p,
  };
}

describe("snoozed reminders in Postgres", () => {
  const repo = new PostgresTaskRepo();

  it("round-trip the snooze mark and count as reminder candidates", async () => {
    const snooze = { id: crypto.randomUUID(), kind: "absolute" as const, at: "2031-05-12T07:00:00.000Z", snooze: true as const };
    const plain = { id: crypto.randomUUID(), kind: "absolute" as const, at: "2031-05-12T06:00:00.000Z" };
    const t = row({ reminders: [snooze, plain] });
    await repo.insert(t);
    const got = await repo.get(t.id);
    expect(got?.reminders).toEqual(expect.arrayContaining([snooze, plain]));
    expect(got?.reminders.find((r) => r.id === plain.id)).not.toHaveProperty("snooze");

    await repo.update(t.id, { reminders: [snooze] });
    const ids = (await repo.reminderCandidates("2031-01-01", "2031-01-02", new Date("2031-05-12T06:30:00Z"), new Date("2031-05-12T07:00:00Z"))).map((x) => x.id);
    expect(ids).toContain(t.id);
  });
});
