// T5: due times, recurrence, reminders and notifications through the API,
// on the in-memory repo with a mocked session.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let viewer: string | null = "alice";
vi.mock("@/lib/session", () => ({ getViewerLogin: async () => viewer }));

const tasksRoute = await import("@/app/api/tasks/route");
const taskRoute = await import("@/app/api/tasks/[id]/route");
const notesRoute = await import("@/app/api/notifications/route");
const readRoute = await import("@/app/api/notifications/read/route");
const prefsRoute = await import("@/app/api/me/prefs/route");
const commentsRoute = await import("@/app/api/tasks/[id]/comments/route");
const { __resetTasks } = await import("@/lib/tasks/repo");
const { fireReminders, reminderTimes } = await import("@/lib/tasks/notify");

type J = Record<string, unknown>;
const req = (method: string, body?: unknown) =>
  new NextRequest("http://x/api", { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function as<T>(login: string, fn: () => Promise<Response>): Promise<{ status: number; body: T }> {
  viewer = login;
  const r = await fn();
  return { status: r.status, body: (await r.json()) as T };
}
type T = J & { id: string; dueDate: string | null; completedAt: string | null };
const create = (body: J, login = "alice") => as<{ task: T }>(login, () => tasksRoute.POST(req("POST", body)));
const patch = (id: string, body: J, login = "alice") => as<{ task: T }>(login, () => taskRoute.PATCH(req("PATCH", body), ctx(id)));
type N = { list: { kind: string; title: string; id: string; readAt: string | null }[]; unread: number };
const notes = (login: string) => as<N>(login, () => notesRoute.GET(req("GET")));

beforeEach(() => {
  __resetTasks();
});
afterEach(() => vi.useRealTimers());

describe("due times and recurrence (§12.5)", () => {
  it("stores a due time in the creator's zone; a time needs a date", async () => {
    const { body } = await create({ title: "Call", dueDate: "2026-10-12", dueTime: "15:00", tz: "Europe/Prague" });
    expect(body.task).toMatchObject({ dueTime: "15:00", dueTz: "Europe/Prague" });
    expect((await create({ title: "x", dueTime: "15:00" })).status).toBe(400);
    expect((await create({ title: "x", dueDate: "2026-10-12", tz: "Mars/Olympus" })).status).toBe(400);
  });

  it("uses the creator's preferred zone when the client sends none", async () => {
    await as("alice", () => prefsRoute.PATCH(req("PATCH", { tz: "America/New_York" })));
    const { body } = await create({ title: "Call", dueDate: "2026-10-12", dueTime: "09:00" });
    expect(body.task.dueTz).toBe("America/New_York");
  });

  it("completing a recurring task advances the due date, logs it and reopens sub-tasks", async () => {
    const { body } = await create({ title: "Standup", dueDate: "2026-10-16", recurrence: { rule: "FREQ=WEEKLY;BYDAY=FR", text: "every friday", fromCompletion: false } });
    const child = await create({ title: "Notes", parentId: body.task.id });
    await patch(child.body.task.id, { completed: true });
    const done = await patch(body.task.id, { completed: true });
    expect(done.body.task).toMatchObject({ dueDate: "2026-10-23", completedAt: null });
    const listed = await as<{ tasks: T[] }>("alice", () => tasksRoute.GET(req("GET")));
    expect(listed.body.tasks.find((t) => t.id === child.body.task.id)?.completedAt).toBeNull();
  });

  it("absolute reminders move with the occurrence, keeping their local time across DST", async () => {
    const { body } = await create({
      title: "Report",
      dueDate: "2026-10-23",
      tz: "Europe/Prague",
      recurrence: { rule: "FREQ=WEEKLY;BYDAY=FR", text: "every friday", fromCompletion: false },
      reminders: [{ kind: "absolute", at: "2026-10-22T16:00:00.000Z" }],
    });
    const before = (body.task.reminders as { id: string }[])[0]!;
    const done = await patch(body.task.id, { completed: true });
    // 18:00 Prague on Thu 22 Oct (CEST) -> 18:00 Prague on Thu 29 Oct (CET).
    const after = (done.body.task.reminders as { id: string; at: string }[])[0]!;
    expect(after.at).toBe("2026-10-29T17:00:00.000Z");
    expect(after.id).not.toBe(before.id);
  });

  it("every! counts from the completion day; Complete forever ends the recurrence", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-20T10:00:00Z"), toFake: ["Date"] });
    const { body } = await create({ title: "Water plants", dueDate: "2026-10-12", recurrence: { rule: "FREQ=DAILY;INTERVAL=3", text: "every! 3 days", fromCompletion: true } });
    expect((await patch(body.task.id, { completed: true })).body.task.dueDate).toBe("2026-10-23");
    const forever = await patch(body.task.id, { completed: true, endRecurrence: true });
    expect(forever.body.task.completedAt).not.toBeNull();
    expect(forever.body.task.recurrence).toBeNull();
  });

  it("every! completed the day before it is due moves past the due date and can be completed again", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-09T10:00:00Z"), toFake: ["Date"] });
    const { body } = await create({ title: "Stretch", dueDate: "2026-11-10", recurrence: { rule: "FREQ=DAILY", text: "every! day", fromCompletion: true } });
    expect((await patch(body.task.id, { completed: true })).body.task.dueDate).toBe("2026-11-11");
    vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
    expect((await patch(body.task.id, { completed: true })).body.task.dueDate).toBe("2026-11-12");
  });

  it("every month from the 31st keeps returning to the month's end", async () => {
    const { body } = await create({ title: "Invoice", dueDate: "2026-01-31", recurrence: { rule: "FREQ=MONTHLY", text: "every month" } });
    expect((body.task.recurrence as { rule: string }).rule).toBe("FREQ=MONTHLY;BYMONTHDAY=31");
    expect((await patch(body.task.id, { completed: true })).body.task.dueDate).toBe("2026-02-28");
    expect((await patch(body.task.id, { completed: true })).body.task.dueDate).toBe("2026-03-31");
  });

  it("clearing the date clears time and recurrence", async () => {
    const { body } = await create({ title: "x", dueDate: "2026-10-12", dueTime: "10:00", recurrence: { rule: "FREQ=DAILY", text: "every day" } });
    const r = await patch(body.task.id, { dueDate: null });
    expect(r.body.task).toMatchObject({ dueDate: null, dueTime: null, recurrence: null });
  });
});

describe("reminders (§12.6)", () => {
  it("a timed task reminds at its due time; all-day tasks don't, unless asked (Q5)", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-12T10:00:00Z"), toFake: ["Date"] });
    await create({ title: "Timed", dueDate: "2026-10-12", dueTime: "12:30", tz: "Europe/Prague" }); // 10:30Z
    await create({ title: "All day", dueDate: "2026-10-12", tz: "Europe/Prague" });
    await create({ title: "All day, reminded", dueDate: "2026-10-12", tz: "Europe/Prague", reminders: [{ kind: "relative", offsetMin: 0 }] }); // 09:00 local = 07:00Z
    // Before 10:30Z: only... nothing yet for Timed; the 07:00Z reminder predates the task.
    expect((await notes("alice")).body.list).toEqual([]);

    vi.setSystemTime(new Date("2026-10-12T10:30:30Z"));
    const n = await notes("alice");
    expect(n.body.list.map((x) => [x.kind, x.title])).toEqual([["reminder", "Timed"]]);
    expect(n.body.unread).toBe(1);
  });

  it("fires within 60 s of the first poll, never twice, whichever account is connected", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-12T08:00:00Z"), toFake: ["Date"] });
    const { body } = await create({ title: "Review", dueDate: "2026-10-12", dueTime: "08:10", tz: "UTC", reminders: [{ kind: "relative", offsetMin: 5 }] });
    vi.setSystemTime(new Date("2026-10-12T08:05:30Z"));
    expect(await fireReminders()).toBe(1); // cron: the 08:05 "5 min before"
    expect(await fireReminders()).toBe(0);
    vi.setSystemTime(new Date("2026-10-12T08:10:45Z"));
    const n = await notes("bob"); // another GitHub account sees the same reminders
    expect(n.body.list.filter((x) => x.kind === "reminder")).toHaveLength(2);
    expect(n.body.list.every((x) => x.title === "Review")).toBe(true);
    // Read state.
    await as("carol", () => readRoute.POST(req("POST", { all: true })));
    expect((await notes("alice")).body.unread).toBe(0);
    expect(body.task.id).toBeTruthy();
  });

  it("a recurring task reminds again for the next occurrence", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-12T07:00:00Z"), toFake: ["Date"] });
    const { body } = await create({ title: "Standup", dueDate: "2026-10-12", dueTime: "09:00", tz: "UTC", recurrence: { rule: "FREQ=DAILY", text: "every day" } });
    vi.setSystemTime(new Date("2026-10-12T09:00:10Z"));
    expect(await fireReminders()).toBe(1);
    await patch(body.task.id, { completed: true });
    vi.setSystemTime(new Date("2026-10-13T09:00:10Z"));
    expect(await fireReminders()).toBe(1);
  });

  it("editing the reminder set doesn't fire an unchanged, already-fired reminder again", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-12T08:00:00Z"), toFake: ["Date"] });
    const { body } = await create({
      title: "Review",
      dueDate: "2026-10-12",
      dueTime: "10:00",
      tz: "UTC",
      reminders: [
        { kind: "relative", offsetMin: 30 },
        { kind: "absolute", at: "2026-10-12T09:00:00.000Z" },
      ],
    });
    vi.setSystemTime(new Date("2026-10-12T09:35:00Z"));
    expect(await fireReminders()).toBe(2);
    // The client sends the full set back with one more reminder added.
    const edited = await patch(body.task.id, {
      reminders: [
        { kind: "relative", offsetMin: 30 },
        { kind: "absolute", at: "2026-10-12T09:00:00Z" },
        { kind: "relative", offsetMin: 10 },
      ],
    });
    const before = (body.task.reminders as { id: string }[]).map((r) => r.id);
    expect((edited.body.task.reminders as { id: string }[]).slice(0, 2).map((r) => r.id)).toEqual(before);
    expect(await fireReminders()).toBe(0);
    vi.setSystemTime(new Date("2026-10-12T09:50:10Z"));
    expect(await fireReminders()).toBe(1); // only the new 10-minute one
  });

  it("an absolute reminder fires once at its instant", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-12T07:00:00Z"), toFake: ["Date"] });
    const { body } = await create({ title: "Ping", reminders: [{ kind: "absolute", at: "2026-10-12T07:30:00.000Z" }] });
    expect(reminderTimes(body.task as never).map((r) => r.at.toISOString())).toEqual(["2026-10-12T07:30:00.000Z"]);
    vi.setSystemTime(new Date("2026-10-12T07:30:20Z"));
    expect(await fireReminders()).toBe(1);
    expect(await fireReminders()).toBe(0);
  });
});

describe("what makes notifications (§4.6)", () => {
  it("assigning is gone; completing, commenting and creating never notify", async () => {
    const { body } = await create({ title: "Ask about copy", assignee: "bob" });
    await patch(body.task.id, { completed: true });
    await patch(body.task.id, { completed: false });
    await as("alice", () => commentsRoute.POST(req("POST", { body: "note" }), ctx(body.task.id)));
    for (const login of ["alice", "bob"]) expect((await notes(login)).body).toMatchObject({ list: [], unread: 0 });
  });

  it("deleting a task deletes its notifications", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-12T08:00:00Z"), toFake: ["Date"] });
    const { body } = await create({ title: "Gone soon", dueDate: "2026-10-12", dueTime: "08:10", tz: "UTC" });
    vi.setSystemTime(new Date("2026-10-12T08:10:30Z"));
    expect((await notes("alice")).body.list).toHaveLength(1);
    await as("alice", () => taskRoute.DELETE(req("DELETE"), ctx(body.task.id)));
    expect((await notes("alice")).body.list).toEqual([]);
  });
});
