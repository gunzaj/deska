// Regressions in personal tasks: snooze on recurring tasks, reminder dedupe
// across undo, a pinned day of the month after the date moves, quick add's
// "on the Nth", restoring an orphaned sub-task, and the DST gap. In-memory repo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));

const { __resetTasks, taskRepo } = await import("@/lib/tasks/repo");
const { createTask, updateTask, snoozeTask, deleteTask, restoreTask, createProject, createSection, listTasks } = await import("@/lib/tasks/service");
const { createTaskSchema } = await import("@/lib/tasks/model");
const { fireReminders } = await import("@/lib/tasks/notify");
const { parseQuickAdd } = await import("@/lib/tasks/quick-add");
const { zonedToUtc } = await import("@/lib/tasks/dates");
const { LOCAL_OWNER } = await import("@/lib/local-owner");

const me = LOCAL_OWNER;
const make = async (input: Record<string, unknown>) => {
  const r = await createTask(me, createTaskSchema.parse({ tz: "UTC", ...input }));
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const update = async (id: string, patch: Parameters<typeof updateTask>[2]) => {
  const r = await updateTask(me, id, patch);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  __resetTasks();
  vi.useFakeTimers({ now: new Date("2026-10-12T06:00:00Z"), toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("snooze on a recurring task is one-shot", () => {
  it("completing the occurrence drops the snooze instead of moving it to every later day", async () => {
    const t = await make({ title: "Stretch", dueDate: "2026-10-12", dueTime: "07:30", recurrence: { rule: "FREQ=DAILY", text: "every day" } });
    at("2026-10-12T07:31:00Z");
    const snoozed = await snoozeTask(me, t.id, "1h");
    expect(snoozed.ok && snoozed.value.reminders).toMatchObject([{ kind: "absolute", at: "2026-10-12T08:31:00.000Z", snooze: true }]);
    // The client resends the full set without the flag: it stays a snooze.
    const resent = await update(t.id, { reminders: [{ kind: "absolute", at: "2026-10-12T08:31:00.000Z" }, { kind: "relative", offsetMin: 10 }] });
    expect(resent.reminders.find((r) => r.kind === "absolute")).toMatchObject({ snooze: true });

    const done = await update(t.id, { completed: true });
    expect(done.dueDate).toBe("2026-10-13");
    expect(done.reminders).toEqual([expect.objectContaining({ kind: "relative", offsetMin: 10 })]);
    // Nothing fires at 08:31 the next day.
    at("2026-10-13T08:31:30Z");
    await fireReminders(new Date(), me);
    at("2026-10-13T08:32:00Z");
    expect(await fireReminders(new Date(), me)).toBe(0);
  });

  it("snoozing keeps the task's own passed absolute reminder, which then moves with the occurrence", async () => {
    const t = await make({ title: "Pills", dueDate: "2026-10-12", recurrence: { rule: "FREQ=DAILY", text: "every day" }, reminders: [{ kind: "absolute", at: "2026-10-12T07:00:00Z" }] });
    at("2026-10-12T07:05:00Z");
    await snoozeTask(me, t.id, "1h");
    const done = await update(t.id, { completed: true });
    expect(done.reminders).toEqual([expect.objectContaining({ kind: "absolute", at: "2026-10-13T07:00:00.000Z" })]);
    expect(done.reminders[0]).not.toHaveProperty("snooze");
  });
});

describe("an absolute reminder that already fired stays fired", () => {
  it("a one-off reminder fired before the upgrade keeps its old dedupe key", async () => {
    const t = await make({ title: "Call", dueDate: "2026-10-12", reminders: [{ kind: "absolute", at: "2026-10-12T08:00:00Z" }] });
    const repo = taskRepo();
    at("2026-10-12T08:00:30Z");
    await repo.addNotification({ login: me, kind: "reminder", taskId: t.id, title: t.title, dedupeKey: `rem:${t.id}:abs:${t.reminders[0]!.id}` });
    expect(await fireReminders(new Date(), me)).toBe(0);
  });
});

describe("undoing an occurrence doesn't fire its absolute reminder again", () => {
  it("complete then undo: the 08:00 reminder that already fired stays fired", async () => {
    const t = await make({ title: "Report", dueDate: "2026-10-12", recurrence: { rule: "FREQ=DAILY", text: "every day" }, reminders: [{ kind: "absolute", at: "2026-10-12T08:00:00Z" }] });
    at("2026-10-12T08:00:30Z");
    expect(await fireReminders(new Date(), me)).toBe(1);
    await update(t.id, { completed: true });
    const undone = await update(t.id, { undoOccurrence: "2026-10-12" });
    expect(undone.reminders).toMatchObject([{ kind: "absolute", at: "2026-10-12T08:00:00.000Z" }]);
    expect(await fireReminders(new Date(), me)).toBe(0);
  });

  it("a moved reminder still fires for the next occurrence", async () => {
    const t = await make({ title: "Report", dueDate: "2026-10-12", recurrence: { rule: "FREQ=DAILY", text: "every day" }, reminders: [{ kind: "absolute", at: "2026-10-12T08:00:00Z" }] });
    at("2026-10-12T08:00:30Z");
    expect(await fireReminders(new Date(), me)).toBe(1);
    await update(t.id, { completed: true });
    at("2026-10-13T08:00:30Z");
    expect(await fireReminders(new Date(), me)).toBe(1);
  });
});

describe("a day of the month taken from the date follows the date", () => {
  it("every month, created on the 30th and moved to the 15th, repeats on the 15th", async () => {
    const t = await make({ title: "Rent", dueDate: "2026-11-30", recurrence: { rule: "FREQ=MONTHLY", text: "every month" } });
    expect(t.recurrence?.rule).toBe("FREQ=MONTHLY;BYMONTHDAY=30");
    const moved = await update(t.id, { dueDate: "2026-11-15" });
    expect(moved.recurrence?.rule).toBe("FREQ=MONTHLY");
    expect((await update(t.id, { completed: true })).dueDate).toBe("2026-12-15");
  });

  it("moving to another late day re-pins to that day", async () => {
    const t = await make({ title: "Rent", dueDate: "2026-11-30", recurrence: { rule: "FREQ=MONTHLY", text: "every month" } });
    expect((await update(t.id, { dueDate: "2026-12-29" })).recurrence?.rule).toBe("FREQ=MONTHLY;BYMONTHDAY=29");
  });

  it("every year from 29 Feb, moved to 10 Mar, repeats on 10 Mar", async () => {
    const t = await make({ title: "Leap", dueDate: "2028-02-29", recurrence: { rule: "FREQ=YEARLY", text: "every year" } });
    expect(t.recurrence?.rule).toBe("FREQ=YEARLY;BYMONTHDAY=29");
    await update(t.id, { dueDate: "2028-03-10" });
    expect((await update(t.id, { completed: true })).dueDate).toBe("2029-03-10");
  });

  it("clearing the recurrence while the date moves keeps it cleared", async () => {
    const t = await make({ title: "Rent", dueDate: "2026-11-30", recurrence: { rule: "FREQ=MONTHLY", text: "every month" } });
    const moved = await update(t.id, { dueDate: "2026-11-15", recurrence: null });
    expect(moved.recurrence).toBeNull();
    expect((await update(t.id, { completed: true })).dueDate).toBe("2026-11-15");
  });

  it("an explicitly chosen day stays", async () => {
    const t = await make({ title: "Rent", dueDate: "2026-11-30", recurrence: { rule: "FREQ=MONTHLY;BYMONTHDAY=30", text: "every month on the 30th" } });
    const moved = await update(t.id, { dueDate: "2026-11-15" });
    expect(moved.recurrence?.rule).toBe("FREQ=MONTHLY;BYMONTHDAY=30");
    expect((await update(t.id, { completed: true })).dueDate).toBe("2026-11-30");
  });
});

describe("quick add: 'on the Nth' outside monthly stays in the title", () => {
  const ctx = { today: "2026-11-10" };
  it.each([
    ["x every year on the 5th", "FREQ=YEARLY", "x on the 5th"],
    ["x every friday on the 15th", "FREQ=WEEKLY;BYDAY=FR", "x on the 15th"],
    ["x every day on the 5th", "FREQ=DAILY", "x on the 5th"],
    ["x every 2 weeks on the 3rd", "FREQ=WEEKLY;INTERVAL=2", "x on the 3rd"],
  ])("%s", (input, rule, title) => {
    const p = parseQuickAdd(input, ctx);
    expect(p.recurrence?.rule).toBe(rule);
    expect(p.title).toBe(title);
  });

  it("monthly still takes it", () => {
    const p = parseQuickAdd("x every month on the 15th", ctx);
    expect(p).toMatchObject({ title: "x", dueDate: "2026-11-15", recurrence: { rule: "FREQ=MONTHLY;BYMONTHDAY=15", label: "every month on the 15th" } });
  });
});

describe("restoring a sub-task whose parent was deleted", () => {
  it("comes back as a top-level task in the parent's project", async () => {
    const p = await createProject(me, { name: "Home", color: "grey" });
    if (!p.ok) throw new Error(p.error);
    const parent = await make({ title: "Move", projectId: p.value.id });
    const child = await make({ title: "Boxes", parentId: parent.id });
    expect((await deleteTask(me, child.id)).ok).toBe(true);
    expect((await deleteTask(me, parent.id)).ok).toBe(true);

    const r = await restoreTask(me, child.id);
    expect(r.ok && r.value).toMatchObject({ id: child.id, parentId: null, projectId: p.value.id });
    const listed = (await listTasks(me)).tasks;
    expect(listed.map((t) => t.id)).toEqual([child.id]);
  });

  it("a sub-task restored while its parent is live stays a sub-task", async () => {
    const parent = await make({ title: "Move" });
    const child = await make({ title: "Boxes", parentId: parent.id });
    await deleteTask(me, child.id);
    const r = await restoreTask(me, child.id);
    expect(r.ok && r.value.parentId).toBe(parent.id);
  });
});

describe("zonedToUtc in the spring-forward gap", () => {
  it("lands after the gap east and west of UTC", () => {
    // Prague: 02:00 CET → 03:00 CEST. 02:30 → 03:30 CEST = 01:30Z.
    expect(zonedToUtc("2026-03-29", "02:30", "Europe/Prague").toISOString()).toBe("2026-03-29T01:30:00.000Z");
    // New York: 02:00 EST → 03:00 EDT. 02:30 → 03:30 EDT = 07:30Z (not 01:30 EST).
    expect(zonedToUtc("2026-03-08", "02:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("an hour repeated by the fall-back is its first occurrence; ordinary times are unchanged", () => {
    expect(zonedToUtc("2026-10-25", "02:30", "Europe/Prague").toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(zonedToUtc("2026-11-01", "01:30", "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(zonedToUtc("2026-03-08", "01:59", "America/New_York").toISOString()).toBe("2026-03-08T06:59:00.000Z");
    expect(zonedToUtc("2026-03-08", "03:00", "America/New_York").toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });
});

describe("a recurring task can't get stuck (T-1)", () => {
  const daily = { rule: "FREQ=DAILY", text: "every day", fromCompletion: false };
  it("undoing an older occurrence is refused, so later completions keep moving the date", async () => {
    const t = await make({ title: "Water", dueDate: "2026-10-12", recurrence: daily });
    await update(t.id, { completed: true }); // 12 -> 13
    await update(t.id, { completed: true }); // 13 -> 14
    const refused = await updateTask(me, t.id, { undoOccurrence: "2026-10-12" });
    expect(refused).toMatchObject({ ok: false, status: 400 });
    await update(t.id, { undoOccurrence: "2026-10-13" });
    await update(t.id, { completed: true });
    expect((await update(t.id, { completed: true })).dueDate).toBe("2026-10-15");
  });

  it("an occurrence that is already logged still moves the date", async () => {
    const t = await make({ title: "Water", dueDate: "2026-10-12", recurrence: daily });
    await update(t.id, { completed: true });
    await update(t.id, { dueDate: "2026-10-12" }); // the date is put back by hand
    expect((await update(t.id, { completed: true })).dueDate).toBe("2026-10-13");
  });
});

describe("undo after a delete or a drag", () => {
  it("delete then restore doesn't fire the day's reminders again (T-3)", async () => {
    const t = await make({ title: "Call", dueDate: "2026-10-12", dueTime: "08:00" });
    at("2026-10-12T08:00:30Z");
    expect(await fireReminders(new Date(), me)).toBe(1);
    await deleteTask(me, t.id);
    await restoreTask(me, t.id);
    expect(await fireReminders(new Date(), me)).toBe(0);
  });

  it("moving to a project and back restores the section and position (T-2)", async () => {
    const a = await createProject(me, { name: "Alpha", color: "blue" });
    const b = await createProject(me, { name: "Beta", color: "green" });
    if (!a.ok || !b.ok) throw new Error("project");
    const sec = await createSection(me, { projectId: a.value.id, name: "Doing" });
    if (!sec.ok) throw new Error("section");
    const t = await make({ title: "Drag", projectId: a.value.id, sectionId: sec.value.id });
    await make({ title: "Later", projectId: a.value.id });
    const before = (await taskRepo().placements(me)).get(t.id)!;
    // What the drop sends to undo: where the task was filed.
    await update(t.id, { projectId: b.value.id });
    const moved = (await listTasks(me)).tasks.find((x) => x.id === t.id)!;
    expect(moved).toMatchObject({ projectId: b.value.id, sectionId: null });
    await update(t.id, { projectId: a.value.id, sectionId: sec.value.id, position: before.position });
    const back = (await listTasks(me)).tasks.find((x) => x.id === t.id)!;
    expect(back).toMatchObject({ projectId: a.value.id, sectionId: sec.value.id, position: before.position });
  });
});

describe("reminders", () => {
  it("making a one-off task recurring doesn't re-fire a reminder that fired (T-10)", async () => {
    const t = await make({ title: "Call", dueDate: "2026-10-12", reminders: [{ kind: "absolute", at: "2026-10-12T08:00:00Z" }] });
    at("2026-10-12T08:00:30Z");
    expect(await fireReminders(new Date(), me)).toBe(1);
    await update(t.id, { recurrence: { rule: "FREQ=DAILY", text: "every day", fromCompletion: false } });
    expect(await fireReminders(new Date(), me)).toBe(0);
  });

  it("snooze at ten reminders drops the oldest snooze, never the user's own (T-11)", async () => {
    const own = Array.from({ length: 9 }, (_, i) => ({ kind: "relative" as const, offsetMin: (i + 1) * 5 }));
    const t = await make({ title: "Busy", dueDate: "2026-10-12", dueTime: "10:00", reminders: own });
    await snoozeTask(me, t.id, "1h");
    const second = await snoozeTask(me, t.id, "tomorrow");
    expect(second.ok && second.value.reminders.filter((r) => r.kind === "relative")).toHaveLength(9);
    expect(second.ok && second.value.reminders.filter((r) => r.kind === "absolute")).toHaveLength(1);
    // Ten of the user's own: nothing to drop, so snooze is refused and nothing is lost.
    const full = await make({ title: "Full", dueDate: "2026-10-12", reminders: Array.from({ length: 10 }, (_, i) => ({ kind: "relative" as const, offsetMin: (i + 1) * 5 })) });
    expect(await snoozeTask(me, full.id, "1h")).toMatchObject({ ok: false });
    expect((await taskRepo().get(full.id))?.reminders).toHaveLength(10);
  });
});
