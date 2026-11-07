// Integration test for PostgresTaskRepo. Runs on an in-memory
// PGlite database (tests/setup/db.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { taskProjects, taskReminders } from "@/db/schema";
import { COMPLETED_LIMIT, PostgresTaskRepo, type StoredTask } from "@/lib/tasks/repo";

function row(p: Partial<StoredTask>): StoredTask {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    creator: "alice",
    parentId: null,
    title: "t",
    description: "",
    priority: 4,
    dueDate: null,
    dueTime: null,
    dueTz: null,
    recurrence: null,
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

describe("PostgresTaskRepo", () => {
  const repo = new PostgresTaskRepo();

  beforeAll(async () => {
    await getDb().execute(sql`TRUNCATE tasks, task_links, task_projects, task_placements, task_labels, task_label_links, task_reminders, task_completions, task_comments, notifications, user_prefs RESTART IDENTITY CASCADE`);
  });

  it("round-trips fields, including the date and priority", async () => {
    const t = row({ title: "Spec", description: "ctx", priority: 2, dueDate: "2026-10-13" });
    await repo.insert(t);
    const got = await repo.get(t.id);
    expect(got).toMatchObject({ title: "Spec", description: "ctx", priority: 2, dueDate: "2026-10-13", creator: "alice" });
  });

  it("lists live tasks only: soft-deleted ones are hidden in SQL", async () => {
    const live = row({ creator: "alice" });
    const other = row({ creator: "bob" }); // whoever created it: all of it belongs to this install (§4.6)
    const gone = row({ creator: "alice", deletedAt: new Date().toISOString() });
    for (const t of [live, other, gone]) await repo.insert(t);
    const ids = (await repo.list()).map((t) => t.id);
    expect(ids).toContain(live.id);
    expect(ids).toContain(other.id);
    expect(ids).not.toContain(gone.id);
    expect(await repo.get(gone.id)).toBeNull();
    expect((await repo.getDeleted(gone.id))?.id).toBe(gone.id);
    expect(await repo.get("not-a-uuid")).toBeNull();
    expect(await repo.get("-".repeat(36))).toBeNull(); // 36 chars, still not a uuid
  });

  it("returns all open tasks but caps completed ones", async () => {
    const done = Array.from({ length: COMPLETED_LIMIT + 5 }, (_, i) =>
      row({ creator: "cap", completedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }),
    );
    for (const t of done) await repo.insert(t);
    await repo.insert(row({ creator: "cap" }));
    const list = (await repo.list()).filter((t) => t.creator === "cap");
    expect(list.filter((t) => !t.completedAt)).toHaveLength(1);
    expect(list.filter((t) => t.completedAt)).toHaveLength(COMPLETED_LIMIT);
  });

  it("updates only the given fields", async () => {
    const t = row({ title: "Before", priority: 3 });
    await repo.insert(t);
    await repo.update(t.id, { title: "After", completedAt: "2026-10-12T10:00:00.000Z", completedBy: "alice" });
    expect(await repo.get(t.id)).toMatchObject({ title: "After", priority: 3, completedBy: "alice" });
  });

  it("writes a task and its links in one transaction", async () => {
    // Two links to the same node ID break task_links' primary key: the task row must not stay behind.
    const t = row({ links: [{ kind: "issue", nodeId: "I_dup", number: 1 }, { kind: "issue", nodeId: "I_dup", number: 1 }] });
    await expect(repo.insert(t)).rejects.toThrow();
    expect(await repo.get(t.id)).toBeNull();
  });

  it("stores links in order and replaces them on update", async () => {
    const t = row({ links: [{ kind: "issue", nodeId: "I_2", number: 2 }, { kind: "issue", nodeId: "I_1", number: 1 }] });
    await repo.insert(t);
    expect((await repo.get(t.id))?.links.map((l) => l.number)).toEqual([2, 1]);
    await repo.update(t.id, { links: [{ kind: "issue", nodeId: "I_9", number: 9 }] });
    expect((await repo.get(t.id))?.links).toEqual([{ kind: "issue", nodeId: "I_9", number: 9 }]);
    expect((await repo.list()).find((x) => x.id === t.id)?.links).toHaveLength(1);
  });

  it("lists the sub-tasks of a parent", async () => {
    const parent = row({ creator: "owner" });
    const child = row({ creator: "owner", parentId: parent.id });
    await repo.insert(parent);
    await repo.insert(child);
    expect((await repo.get(child.id))?.id).toBe(child.id);
    expect((await repo.children(parent.id)).map((c) => c.id)).toEqual([child.id]);
  });

  it("keeps placements and labels per owner key", async () => {
    const t = row({ creator: "a" });
    await repo.insert(t);
    const pid = crypto.randomUUID();
    await repo.insertProject({ id: pid, owner: "a", name: "Specs", color: "blue", position: 1, archived: false, source: null });
    await repo.setPlacement(t.id, "a", { projectId: pid, position: 3 });
    await repo.setPlacement(t.id, "a", { projectId: pid, position: 5 }); // upsert
    expect((await repo.placements("a")).get(t.id)).toEqual({ projectId: pid, position: 5 });
    expect((await repo.placements("b")).get(t.id)).toBeUndefined();
    expect(await repo.maxPosition("a", pid)).toBe(5);

    const la = crypto.randomUUID();
    const lb = crypto.randomUUID();
    await repo.insertLabel({ id: la, owner: "a", name: "spec", color: "grey" });
    await repo.insertLabel({ id: lb, owner: "b", name: "later", color: "grey" });
    await repo.setLabelLinks(t.id, "a", [la]);
    await repo.setLabelLinks(t.id, "b", [lb]);
    await repo.setLabelLinks(t.id, "b", []); // clears only b's
    expect((await repo.labelLinks("a")).get(t.id)).toEqual([la]);
    expect((await repo.labelLinks("b")).get(t.id)).toBeUndefined();
    await repo.updateProject(pid, { archived: true, name: "Old" });
    expect((await repo.projects("a"))[0]).toMatchObject({ name: "Old", archived: true, source: null });
    const source = { issues: [{ field: "label" as const, op: "in" as const, values: ["L1"] }], prs: null };
    await repo.updateProject(pid, { source });
    expect((await repo.projects("a"))[0]!.source).toEqual(source);
  });

  it("enforces reminder and project uniqueness at the database level (R2)", async () => {
    const t = row({ creator: "dd", reminders: [{ id: crypto.randomUUID(), kind: "relative", offsetMin: 30 }] });
    await repo.insert(t);
    await expect(getDb().insert(taskReminders).values({ taskId: t.id, kind: "relative", offsetMin: 30 })).rejects.toThrow();

    const p = { id: crypto.randomUUID(), owner: "dd", name: "Specs", color: "blue", position: 0, archived: false, source: null };
    await repo.insertProject(p);
    await expect(getDb().insert(taskProjects).values({ id: crypto.randomUUID(), ownerLogin: "dd", name: "specs", color: "blue", position: 1 })).rejects.toThrow();
  });

  it("round-trips times, recurrence and reminders", async () => {
    const t = row({
      dueDate: "2026-10-12",
      dueTime: "15:00",
      dueTz: "Europe/Prague",
      recurrence: { rule: "FREQ=WEEKLY;BYDAY=FR", text: "every friday", fromCompletion: true },
      reminders: [
        { id: crypto.randomUUID(), kind: "relative", offsetMin: 30 },
        { id: crypto.randomUUID(), kind: "absolute", at: "2026-10-12T07:00:00.000Z" },
      ],
    });
    await repo.insert(t);
    const got = await repo.get(t.id);
    expect(got).toMatchObject({ dueTime: "15:00", dueTz: "Europe/Prague", recurrence: t.recurrence });
    expect(got?.reminders).toHaveLength(2);
    await repo.update(t.id, { recurrence: null, reminders: [] });
    expect(await repo.get(t.id)).toMatchObject({ recurrence: null, reminders: [] });
  });

  it("finds reminder candidates by date window or absolute reminder", async () => {
    const soon = row({ creator: "rc", dueDate: "2026-10-12" });
    const later = row({ creator: "rc", dueDate: "2026-12-01" });
    const abs = row({ creator: "rc", reminders: [{ id: crypto.randomUUID(), kind: "absolute", at: "2026-10-12T07:00:00.000Z" }] });
    const done = row({ creator: "rc", dueDate: "2026-10-12", completedAt: "2026-10-11T00:00:00.000Z" });
    for (const t of [soon, later, abs, done]) await repo.insert(t);
    const ids = (await repo.reminderCandidates("2026-10-10", "2026-10-20", new Date("2026-10-11T07:00:00Z"), new Date("2026-10-12T07:00:00Z"))).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([soon.id, abs.id]));
    expect(ids).not.toContain(later.id);
    expect(ids).not.toContain(done.id);
  });

  it("dedupes notifications, counts unread and marks read per login", async () => {
    const t = row({ creator: "nn" });
    await repo.insert(t);
    const n = { login: "nn", kind: "reminder" as const, taskId: t.id, actor: null, title: "Ping", dedupeKey: `k-${t.id}` };
    expect(await repo.addNotification(n)).toBe(true);
    expect(await repo.addNotification(n)).toBe(false);
    await repo.addNotification({ ...n, dedupeKey: `k2-${t.id}` });
    const { list, unread } = await repo.notifications("nn", 10);
    expect(list).toHaveLength(2);
    expect(unread).toBe(2);
    await repo.markRead("other", "all");
    expect((await repo.notifications("nn", 10)).unread).toBe(2);
    await repo.markRead("nn", [list[0]!.id]);
    expect((await repo.notifications("nn", 10)).unread).toBe(1);
    await repo.deleteNotificationsForTask(t.id);
    expect((await repo.notifications("nn", 10)).list).toEqual([]);
  });

  it("hides notifications for a deleted task but keeps the ones without a task", async () => {
    const t = row({ creator: "cc" });
    await repo.insert(t);
    await repo.addNotification({ login: "aa", kind: "reminder", taskId: t.id, title: "t", dedupeKey: `v-${t.id}` });
    await repo.addNotification({ login: "aa", kind: "watch_digest", taskId: null, title: "1 watched item changed", dedupeKey: `d-${t.id}` });
    expect((await repo.notifications("aa", 10)).unread).toBe(2);
    await repo.update(t.id, { deletedAt: new Date().toISOString() });
    const after = await repo.notifications("aa", 10);
    expect(after.unread).toBe(1);
    expect(after.list.map((n) => n.kind)).toEqual(["watch_digest"]);
  });

  it("stores prefs per login", async () => {
    expect(await repo.prefs("pp")).toEqual({ tz: null, browserNotifications: false, sidebar: null, defaultTeam: null });
    await repo.setPrefs("pp", { tz: "Europe/Prague" });
    expect(await repo.setPrefs("pp", { browserNotifications: true })).toEqual({ tz: "Europe/Prague", browserNotifications: true, sidebar: null, defaultTeam: null });
    const sidebar = { order: ["views" as const, "tasks" as const], hidden: ["labels" as const] };
    await repo.setPrefs("pp", { sidebar });
    expect((await repo.prefs("pp")).sidebar).toEqual(sidebar);
    expect((await repo.setPrefs("pp", { defaultTeam: "c0000001" })).defaultTeam).toBe("c0000001");
    expect((await repo.prefs("pp")).defaultTeam).toBe("c0000001");
    expect((await repo.setPrefs("pp", { defaultTeam: null })).defaultTeam).toBeNull();
  });

  it("stores comments in order and soft-deletes them", async () => {
    const t = row({});
    await repo.insert(t);
    const mk = (body: string, at: string) => ({ id: crypto.randomUUID(), taskId: t.id, author: "alice", body, createdAt: at, updatedAt: at });
    const a = mk("one", "2026-10-12T10:00:00.000Z");
    const b = mk("two", "2026-10-12T11:00:00.000Z");
    await repo.insertComment(b);
    await repo.insertComment(a);
    expect((await repo.comments(t.id)).map((c) => c.body)).toEqual(["one", "two"]);
    await repo.updateComment(a.id, "uno");
    expect((await repo.comment(t.id, a.id))?.body).toBe("uno");
    await repo.deleteComment(b.id);
    expect((await repo.comments(t.id)).map((c) => c.body)).toEqual(["uno"]);
    await repo.deleteCommentsForTask(t.id);
    expect(await repo.comments(t.id)).toEqual([]);
  });

  it("reminder candidates cover every open task due in the window", async () => {
    const a = row({ title: "a", creator: "alice", dueDate: "2026-10-13" });
    const b = row({ title: "b", creator: "bob", dueDate: "2026-10-13" });
    const done = row({ title: "done", dueDate: "2026-10-13", completedAt: "2026-10-12T00:00:00.000Z" });
    const later = row({ title: "later", dueDate: "2026-12-01" });
    for (const t of [a, b, done, later]) await repo.insert(t);
    const got = (await repo.reminderCandidates("2026-10-11", "2026-10-28", new Date("2026-10-12T00:00:00Z"), new Date("2026-10-13T00:00:00Z"))).map((t) => t.title);
    expect(got.filter((t) => ["a", "b", "done", "later"].includes(t)).sort()).toEqual(["a", "b"]);
  });
});
