// D12: reminders and the Dock badge with the window closed. The reminder
// service fires what is due on its own timer, hands each new reminder to the
// main process once, and counts Today for the badge: all on the in-memory repo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));

const snoozeRoute = await import("@/app/api/tasks/[id]/snooze/route");
const { __resetTasks, taskRepo } = await import("@/lib/tasks/repo");
const { createTask, updateTask, snoozeTask, markNotificationsRead } = await import("@/lib/tasks/service");
const { createTaskSchema } = await import("@/lib/tasks/model");
const { dueCount } = await import("@/lib/tasks/counts");
const { newReminderState, reminderTick, badgeChange } = await import("@/lib/desktop/reminders");
const { onTasksChanged } = await import("@/lib/desktop/events");
const { LOCAL_OWNER } = await import("@/lib/local-owner");

const make = async (input: Record<string, unknown>) => {
  const r = await createTask(LOCAL_OWNER, createTaskSchema.parse({ tz: "UTC", ...input }));
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

beforeEach(() => {
  __resetTasks();
  vi.useFakeTimers({ now: new Date("2026-10-12T08:00:00Z"), toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  onTasksChanged(null);
});

describe("reminders with no page polling (D12)", () => {
  it("fires a due reminder from the timer and hands it over exactly once", async () => {
    const state = newReminderState();
    const t = await make({ title: "Call the bank", dueDate: "2026-10-12", dueTime: "08:10" });
    expect((await reminderTick(state)).items).toEqual([]);
    vi.setSystemTime(new Date("2026-10-12T08:10:20Z"));
    const first = await reminderTick(state);
    expect(first.items).toMatchObject([{ taskId: t.id, title: "Call the bank" }]);
    expect(first.items[0]!.notificationId).toBeTruthy();
    // The next tick has nothing new: the notification isn't shown twice.
    vi.setSystemTime(new Date("2026-10-12T08:10:50Z"));
    expect((await reminderTick(state)).items).toEqual([]);
  });

  it("hands over a reminder the page's own poll already created", async () => {
    const state = newReminderState();
    await make({ title: "Review", dueDate: "2026-10-12", dueTime: "08:10" });
    vi.setSystemTime(new Date("2026-10-12T08:11:00Z"));
    const { fireReminders } = await import("@/lib/tasks/notify");
    expect(await fireReminders(new Date(), LOCAL_OWNER)).toBe(1); // what GET /api/notifications does
    expect((await reminderTick(state)).items).toHaveLength(1);
  });

  it("skips notifications from before this run and ones already read", async () => {
    const t = await make({ title: "Old", dueDate: "2026-10-12", dueTime: "08:10" });
    vi.setSystemTime(new Date("2026-10-12T08:20:00Z"));
    const { fireReminders } = await import("@/lib/tasks/notify");
    await fireReminders(new Date(), LOCAL_OWNER);
    vi.setSystemTime(new Date("2026-10-12T08:30:00Z"));
    // A service that starts now: the 08:20 reminder was shown by an earlier run.
    const state = newReminderState();
    expect((await reminderTick(state)).items).toEqual([]);
    expect(t.id).toBeTruthy();

    const read = await make({ title: "Read", dueDate: "2026-10-12", dueTime: "08:31" });
    vi.setSystemTime(new Date("2026-10-12T08:32:00Z"));
    await fireReminders(new Date(), LOCAL_OWNER);
    const unread = (await taskRepo().notifications(LOCAL_OWNER, 10)).list.filter((n) => n.taskId === read.id);
    await markNotificationsRead(LOCAL_OWNER, unread.map((n) => n.id));
    expect((await reminderTick(state)).items).toEqual([]);
  });

  it("an all-day task has no due-time reminder, an absolute one fires", async () => {
    const state = newReminderState();
    await make({ title: "Someday", dueDate: "2026-10-12" });
    await make({ title: "Ping me", dueDate: "2026-10-20", reminders: [{ kind: "absolute", at: "2026-10-12T08:05:00Z" }] });
    vi.setSystemTime(new Date("2026-10-12T08:06:00Z"));
    expect((await reminderTick(state)).items.map((i) => i.title)).toEqual(["Ping me"]);
  });

  it("the in-app bell has the reminder whether or not main shows it", async () => {
    const state = newReminderState();
    await make({ title: "Bell", dueDate: "2026-10-12", dueTime: "08:10" });
    vi.setSystemTime(new Date("2026-10-12T08:10:30Z"));
    await reminderTick(state); // main may drop it (notifications off, or macOS denied)
    const { list, unread } = await taskRepo().notifications(LOCAL_OWNER, 10);
    expect(unread).toBe(1);
    expect(list[0]).toMatchObject({ kind: "reminder", title: "Bell" });
  });
});

describe("snooze (D12)", () => {
  it("Snooze 1 h reminds again in an hour; the first reminder is not repeated", async () => {
    const state = newReminderState();
    const t = await make({ title: "Stretch", dueDate: "2026-10-12", dueTime: "08:10" });
    vi.setSystemTime(new Date("2026-10-12T08:10:10Z"));
    expect((await reminderTick(state)).items).toHaveLength(1);
    const r = await snoozeTask(LOCAL_OWNER, t.id, "1h");
    expect(r.ok && r.value.reminders).toMatchObject([{ kind: "absolute", at: "2026-10-12T09:10:10.000Z" }]);
    vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
    expect((await reminderTick(state)).items).toEqual([]);
    vi.setSystemTime(new Date("2026-10-12T09:10:40Z"));
    expect((await reminderTick(state)).items).toMatchObject([{ taskId: t.id, title: "Stretch" }]);
  });

  it("Tomorrow reminds at 09:00 the next day in the task's time zone", async () => {
    const t = await make({ title: "Plan", dueDate: "2026-10-12", dueTime: "08:10", tz: "Europe/Prague" });
    vi.setSystemTime(new Date("2026-10-12T20:00:00Z")); // 22:00 in Prague
    const r = await snoozeTask(LOCAL_OWNER, t.id, "tomorrow");
    // 09:00 CEST on the 13th = 07:00 UTC
    expect(r.ok && r.value.reminders).toMatchObject([{ kind: "absolute", at: "2026-10-13T07:00:00.000Z" }]);
  });

  it("repeated snoozes replace the passed ones instead of piling up; a completed task refuses", async () => {
    const t = await make({ title: "Again", dueDate: "2026-10-12", dueTime: "08:10" });
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(new Date(Date.parse("2026-10-12T08:00:00Z") + i * 2 * 3_600_000));
      await snoozeTask(LOCAL_OWNER, t.id, "1h");
    }
    const after = await taskRepo().get(t.id);
    expect(after?.reminders).toHaveLength(1);
    await updateTask(LOCAL_OWNER, t.id, { completed: true });
    expect(await snoozeTask(LOCAL_OWNER, t.id, "1h")).toMatchObject({ ok: false, status: 400 });
    expect(await snoozeTask(LOCAL_OWNER, "00000000-0000-4000-8000-000000000000", "1h")).toMatchObject({ ok: false, status: 404 });
  });

  it("the snooze route takes only 1h and tomorrow", async () => {
    const t = await make({ title: "Route", dueDate: "2026-10-12", dueTime: "08:10" });
    const post = (body: unknown) => snoozeRoute.POST(new NextRequest("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: t.id }) });
    expect((await post({ for: "1h" })).status).toBe(200);
    expect((await post({ for: "2h" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });
});

describe("Dock badge (D12)", () => {
  const T = (over: object) => ({ completedAt: null, projectId: null, dueDate: null as string | null, ...over });

  it("counts open tasks overdue or due today, sub-tasks included, archived projects left out", () => {
    const projects = [{ id: "p1", archived: false }, { id: "p2", archived: true }];
    const tasks = [
      T({ dueDate: "2026-10-11" }), // overdue
      T({ dueDate: "2026-10-12" }), // today
      T({ dueDate: "2026-10-13" }), // tomorrow
      T({}), // no date
      T({ dueDate: "2026-10-12", completedAt: "2026-10-12T07:00:00Z" }), // done
      T({ dueDate: "2026-10-12", projectId: "p2" }), // archived project
      T({ dueDate: "2026-10-12", projectId: "p1" }),
    ];
    expect(dueCount(tasks, projects, "2026-10-12")).toBe(3);
  });

  it("is reported when it changes and not again while it stays the same", async () => {
    const state = newReminderState();
    expect(await badgeChange(state, new Date(), "UTC")).toBe(0);
    expect(await badgeChange(state, new Date(), "UTC")).toBeNull();
    const t = await make({ title: "Today", dueDate: "2026-10-12" });
    await make({ title: "Overdue", dueDate: "2026-10-01" });
    expect(await badgeChange(state, new Date(), "UTC")).toBe(2);
    await updateTask(LOCAL_OWNER, t.id, { completed: true });
    expect(await badgeChange(state, new Date(), "UTC")).toBe(1);
    // The day rolls over: tomorrow's task is now due, next to the one still overdue.
    await make({ title: "Tomorrow", dueDate: "2026-10-13" });
    expect(await badgeChange(state, new Date("2026-10-13T00:30:00Z"), "UTC")).toBe(2);
  });

  it("reads today in the given zone, not UTC", async () => {
    await make({ title: "Local", dueDate: "2026-10-13" });
    // 23:30 UTC on the 12th is already the 13th in Prague.
    expect(await badgeChange(newReminderState(), new Date("2026-10-12T23:30:00Z"), "Europe/Prague")).toBe(1);
    expect(await badgeChange(newReminderState(), new Date("2026-10-12T23:30:00Z"), "UTC")).toBe(0);
  });

  it("task edits tell the desktop service, so the badge follows without waiting for a tick", async () => {
    const seen: string[] = [];
    onTasksChanged(() => seen.push("changed"));
    const t = await make({ title: "A" });
    await updateTask(LOCAL_OWNER, t.id, { title: "B" });
    const { deleteTask, restoreTask } = await import("@/lib/tasks/service");
    await deleteTask(LOCAL_OWNER, t.id);
    await restoreTask(LOCAL_OWNER, t.id);
    expect(seen).toHaveLength(4);
  });
});
