import { describe, expect, it } from "vitest";
import { addDays, dueLabel, localToday } from "@/lib/tasks/dates";
import { compareTasks, createTaskSchema, HOME_PANELS, patchTaskSchema, prefsSchema, resolveHome, resolveSidebar, SIDEBAR_SECTIONS, startPath, type Task } from "@/lib/tasks/model";

function task(p: Partial<Task>): Task {
  return {
    id: p.id ?? "t",
    creator: "local",
    parentId: null,
    sectionId: null,
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
  it("applies defaults and drops an assignee: there are none (§4.6)", () => {
    const r = createTaskSchema.parse({ title: "  Finish spec  ", assignee: "Bob" });
    expect(r).toEqual({ title: "Finish spec", description: "", priority: 4, dueDate: null, dueTime: null, recurrence: null, reminders: [], links: [], parentId: null, sectionId: null, projectId: null, labels: [] });
  });
  it("rejects empty titles, bad dates and bad priorities", () => {
    expect(createTaskSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "a", dueDate: "2026-02-30" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: "a", priority: 5 }).success).toBe(false);
  });
  it("patch is strict: unknown fields such as creator are refused", () => {
    expect(patchTaskSchema.safeParse({ creator: "evil" }).success).toBe(false);
    expect(patchTaskSchema.safeParse({ assignee: "bob" }).success).toBe(false);
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
    const out = resolveSidebar({ order: ["views", "tasks"], hidden: ["labels"] });
    expect(out.map((s) => s.id)).toEqual(["views", "tasks", "projects", "labels", "workspace", "teams"]);
    expect(out.filter((s) => s.hidden).map((s) => s.id)).toEqual(["labels"]);
  });

  it("drops a section that no longer exists, such as the pull requests one (D6)", () => {
    const out = resolveSidebar({ order: ["pulls", "views"], hidden: ["pulls"] } as never);
    expect(out.map((s) => s.id)).not.toContain("pulls");
    expect(out.filter((s) => s.hidden)).toEqual([]);
  });

  it("drops duplicates and unknown ids from stored layouts", () => {
    const out = resolveSidebar({ order: ["teams", "teams", "gone" as never], hidden: [] });
    expect(out.map((s) => s.id)).toEqual(["teams", "tasks", "projects", "labels", "workspace", "views"]);
  });

  it("only accepts known section ids", () => {
    expect(prefsSchema.safeParse({ sidebar: { order: ["tasks"], hidden: ["labels"] } }).success).toBe(true);
    expect(prefsSchema.safeParse({ sidebar: { order: ["tasks"], hidden: ["pulls"] } }).success).toBe(false);
    expect(prefsSchema.safeParse({ sidebar: null }).success).toBe(true);
    expect(prefsSchema.safeParse({ sidebar: { order: ["nope"], hidden: [] } }).success).toBe(false);
  });
});

describe("sidebar sections in any order (HOME-SPEC §2.5)", () => {
  it("keeps a stored order that mixes the task and GitHub sections", () => {
    const out = resolveSidebar({ order: ["workspace", "projects", "views", "tasks", "teams", "labels"], hidden: ["teams"] });
    expect(out.map((s) => s.id)).toEqual(["workspace", "projects", "views", "tasks", "teams", "labels"]);
    expect(out.filter((s) => s.hidden).map((s) => s.id)).toEqual(["teams"]);
  });
});

describe("start page and Home layout (HOME-SPEC §3.1, §5)", () => {
  it("opens Home unless the start page says otherwise", () => {
    expect([startPath(null), startPath(undefined), startPath("home"), startPath("my"), startPath("today")]).toEqual(["/home", "/home", "/home", "/my", "/tasks/today"]);
  });

  it("tasks-only mode has no My issues: it opens Home instead", () => {
    expect([startPath("my", true), startPath("today", true), startPath(null, true)]).toEqual(["/home", "/tasks/today", "/home"]);
  });

  it("accepts only the three start pages", () => {
    expect(prefsSchema.safeParse({ startPage: "today" }).success).toBe(true);
    expect(prefsSchema.safeParse({ startPage: null }).success).toBe(true);
    expect(prefsSchema.safeParse({ startPage: "issues" }).success).toBe(false);
  });

  it("Home panels: saved order first, panels added later at the end, unknown ones dropped", () => {
    expect(resolveHome(null)).toEqual(HOME_PANELS.map((id) => ({ id, hidden: false })));
    const out = resolveHome({ order: ["changes", "work", "gone" as never], hidden: ["epics"] });
    expect(out.map((p) => p.id)).toEqual(["changes", "work", "sprint", "epics", "attention"]);
    expect(out.filter((p) => p.hidden).map((p) => p.id)).toEqual(["epics"]);
    expect(prefsSchema.safeParse({ home: { order: ["work"], hidden: ["sprint"] } }).success).toBe(true);
    expect(prefsSchema.safeParse({ home: { order: ["tiles"], hidden: [] } }).success).toBe(false);
  });
});
