import { describe, expect, it } from "vitest";
import { addDays, dueLabel, localToday } from "@/lib/tasks/dates";
import { canDelete, canSee, compareTasks, createTaskSchema, inInbox, isDelegated, patchTaskSchema, prefsSchema, resolveSidebar, SIDEBAR_SECTIONS, type Task } from "@/lib/tasks/model";

function task(p: Partial<Task>): Task {
  return {
    id: p.id ?? "t",
    creator: "alice",
    assignee: null,
    parentId: null,
    title: "x",
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
    projectId: null,
    position: 0,
    labels: [],
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...p,
  };
}

describe("visibility (SPEC §12.2)", () => {
  const t = task({ creator: "alice", assignee: "bob" });
  it("creator and assignee see it, nobody else", () => {
    expect(canSee(t, "alice")).toBe(true);
    expect(canSee(t, "Bob")).toBe(true);
    expect(canSee(t, "someone")).toBe(false);
  });
  it("only the creator deletes (Q3)", () => {
    expect(canDelete(t, "alice")).toBe(true);
    expect(canDelete(t, "bob")).toBe(false);
  });
  it("inbox holds my assigned and my own unassigned tasks; delegated holds the rest I created", () => {
    expect(inInbox(task({ assignee: null }), "alice")).toBe(true);
    expect(inInbox(t, "bob")).toBe(true);
    expect(inInbox(t, "alice")).toBe(false);
    expect(isDelegated(t, "alice")).toBe(true);
    expect(isDelegated(t, "bob")).toBe(false);
  });
});

describe("default order (SPEC §9 T1)", () => {
  it("overdue first, then due date, then priority, then created; no date last", () => {
    const list = [
      task({ id: "nodate-p1", priority: 1 }),
      task({ id: "later", dueDate: "2026-10-20" }),
      task({ id: "overdue", dueDate: "2026-10-01" }),
      task({ id: "today-p4", dueDate: "2026-10-12", priority: 4 }),
      task({ id: "today-p2-new", dueDate: "2026-10-12", priority: 2, createdAt: "2026-10-05T00:00:00.000Z" }),
      task({ id: "today-p2-old", dueDate: "2026-10-12", priority: 2, createdAt: "2026-10-02T00:00:00.000Z" }),
    ];
    expect(list.sort(compareTasks).map((t) => t.id)).toEqual(["overdue", "today-p2-old", "today-p2-new", "today-p4", "later", "nodate-p1"]);
  });
});

describe("input validation", () => {
  it("applies defaults and normalises the assignee", () => {
    const r = createTaskSchema.parse({ title: "  Finish spec  ", assignee: "Bob" });
    expect(r).toEqual({ title: "Finish spec", description: "", priority: 4, dueDate: null, dueTime: null, recurrence: null, reminders: [], assignee: "bob", links: [], parentId: null, projectId: null, labels: [] });
  });
  it("rejects empty titles, bad dates, bad priorities and bad logins", () => {
    expect(createTaskSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "a", dueDate: "2026-02-30" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "a", priority: 5 }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "a", assignee: "-bad" }).success).toBe(false);
  });
  it("patch is strict: unknown fields such as creator are refused", () => {
    expect(patchTaskSchema.safeParse({ creator: "evil" }).success).toBe(false);
    expect(patchTaskSchema.parse({ completed: true })).toEqual({ completed: true });
  });
});

describe("due labels", () => {
  const today = "2026-10-12"; // a Monday
  it("names nearby days and flags overdue", () => {
    expect(dueLabel(today, today)).toEqual({ text: "Today", tone: "today" });
    expect(dueLabel("2026-10-13", today).text).toBe("Tomorrow");
    expect(dueLabel("2026-10-11", today)).toEqual({ text: "Yesterday", tone: "overdue" });
    expect(dueLabel("2026-10-16", today).text).toBe("Friday");
    expect(dueLabel("2026-10-01", today)).toEqual({ text: "1 Oct", tone: "overdue" });
    expect(dueLabel("2027-01-05", today).text).toBe("5 Jan 2027");
  });
  it("computes today in a given time zone and adds days across month ends", () => {
    const late = new Date("2026-10-12T23:30:00Z");
    expect(localToday(late, "UTC")).toBe("2026-10-12");
    expect(localToday(late, "Europe/Prague")).toBe("2026-10-13");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("sidebar layout", () => {
  it("defaults to every section, shown, in the default order", () => {
    expect(resolveSidebar(null)).toEqual(SIDEBAR_SECTIONS.map((id) => ({ id, hidden: false })));
  });

  it("puts saved sections first and appends sections added later", () => {
    const out = resolveSidebar({ order: ["views", "tasks"], hidden: ["pulls"] });
    expect(out.map((s) => s.id)).toEqual(["views", "tasks", "pulls", "projects", "labels", "workspace", "teams"]);
    expect(out.filter((s) => s.hidden).map((s) => s.id)).toEqual(["pulls"]);
  });

  it("drops duplicates and unknown ids from stored layouts", () => {
    const out = resolveSidebar({ order: ["teams", "teams", "gone" as never], hidden: [] });
    expect(out.map((s) => s.id)).toEqual(["teams", "tasks", "pulls", "projects", "labels", "workspace", "views"]);
  });

  it("only accepts known section ids", () => {
    expect(prefsSchema.safeParse({ sidebar: { order: ["tasks"], hidden: ["pulls"] } }).success).toBe(true);
    expect(prefsSchema.safeParse({ sidebar: null }).success).toBe(true);
    expect(prefsSchema.safeParse({ sidebar: { order: ["nope"], hidden: [] } }).success).toBe(false);
  });
});
