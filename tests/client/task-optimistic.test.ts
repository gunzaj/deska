import { describe, expect, it } from "vitest";
import { labelNameOf, mergeServerTask, optimisticFields } from "@/lib/client/task-optimistic";
import { endPosition } from "@/lib/client/task-order";
import { nameTaken } from "@/lib/client/task-names";
import { sidebarCounts } from "@/lib/tasks/counts";
import { isCompleteDate } from "@/lib/tasks/dates";
import type { Task, TaskLabel } from "@/lib/tasks/model";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  creator: "local",
  parentId: null,
  sectionId: null,
  title: "Task",
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
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  projectId: null,
  position: 0,
  labels: [],
  ...over,
});
const labels: TaskLabel[] = [
  { id: "la", name: "waiting", color: "blue" },
  { id: "lb", name: "urgent", color: "red" },
];

describe("optimistic edits (T-4)", () => {
  it("two quick label picks keep both: the second builds on the first", () => {
    const names = (t: Task) => t.labels.map((id) => labelNameOf(id, labels)!);
    let t = task();
    // The picker sends the full list: the first pick, then the second on top of what it shows.
    t = { ...t, ...optimisticFields(t, { labels: [...names(t), "waiting"] }, labels) };
    t = { ...t, ...optimisticFields(t, { labels: [...names(t), "urgent"] }, labels) };
    expect(t.labels).toEqual(["la", "lb"]);
  });

  it("a brand-new label keeps its name until the server answers", () => {
    const t = { ...task(), ...optimisticFields(task(), { labels: ["fresh"] }, labels) };
    expect(t.labels).toEqual(["pending:fresh"]);
    expect(labelNameOf(t.labels[0]!, labels)).toBe("fresh");
  });

  it("removing two reminders quickly removes both, and links follow the same rule", () => {
    let t = task({
      reminders: [
        { id: "r1", kind: "relative", offsetMin: 10 },
        { id: "r2", kind: "relative", offsetMin: 60 },
        { id: "r3", kind: "absolute", at: "2026-10-12T08:00:00.000Z" },
      ],
      links: [{ kind: "issue", nodeId: "I_1", number: 1 }],
    });
    t = { ...t, ...optimisticFields(t, { reminders: [{ kind: "relative", offsetMin: 60 }, { kind: "absolute", at: "2026-10-12T08:00:00Z" }] }, labels) };
    expect(t.reminders.map((r) => r.id)).toEqual(["r2", "r3"]);
    t = { ...t, ...optimisticFields(t, { reminders: [{ kind: "absolute", at: "2026-10-12T08:00:00Z" }] }, labels) };
    expect(t.reminders.map((r) => r.id)).toEqual(["r3"]);
    t = { ...t, ...optimisticFields(t, { links: [1, 2] }, labels) };
    expect(t.links.map((l) => l.number)).toEqual([1, 2]);
  });
});

describe("a late answer (T-15)", () => {
  it("does not bring back a task deleted meanwhile, but a create or restore adds it", () => {
    const answer = task({ updatedAt: "2026-10-02T00:00:00.000Z" });
    expect(mergeServerTask([], answer, false)).toEqual([]);
    expect(mergeServerTask([], answer, true)).toEqual([answer]);
  });
  it("an older copy never replaces a newer one", () => {
    const newer = task({ title: "new", updatedAt: "2026-10-03T00:00:00.000Z" });
    expect(mergeServerTask([newer], task({ title: "old" }), false)[0]!.title).toBe("new");
  });
});

describe("end of a list (T-6)", () => {
  const rows = [
    { id: "a", position: 1 },
    { id: "b", position: 2 },
    { id: "c", position: 5 },
  ];
  it("puts the first task after the last, and does nothing for the last one", () => {
    expect(endPosition(rows, "a")).toBe(6);
    expect(endPosition(rows, "c")).toBeNull();
  });
});

describe("dialog names and dates", () => {
  it("a name is taken regardless of case, except by the item being renamed (T-7)", () => {
    expect(nameTaken(labels, " Waiting ")).toBe(true);
    expect(nameTaken(labels, "waiting", "la")).toBe(false);
    expect(nameTaken(labels, "later")).toBe(false);
  });
  it("a year typed digit by digit is not a date to save (T-14)", () => {
    expect(["0002-10-12", "0020-10-12", "0202-10-12", ""].map(isCompleteDate)).toEqual([false, false, false, false]);
    expect(isCompleteDate("2026-10-12")).toBe(true);
  });
});

describe("sidebar counts (T-8)", () => {
  it("a project's count equals the rows its page lists: sub-tasks are not counted", () => {
    const tasks = [
      task({ id: "a", projectId: "p1" }),
      task({ id: "b", projectId: "p1", parentId: "a" }),
      task({ id: "c", projectId: "p1", completedAt: "2026-10-02T00:00:00.000Z" }),
      task({ id: "d" }),
      task({ id: "e", parentId: "d" }),
    ];
    const c = sidebarCounts(tasks, [{ id: "p1", archived: false }], "2026-10-12");
    const rows = tasks.filter((t) => t.projectId === "p1" && !t.parentId && !t.completedAt).length;
    expect(c.perProject.get("p1")).toBe(rows);
    expect(c.inbox).toBe(1);
  });
});
