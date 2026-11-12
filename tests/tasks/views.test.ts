// Item 12: a saved task view's strict schema and what it matches.
import { describe, expect, it } from "vitest";
import { taskViewMatches, taskViewPrefill, taskViewSchema, taskViewShowsSubtasks } from "@/lib/tasks/views";
import type { Task } from "@/lib/tasks/model";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  creator: "local",
  parentId: null,
  sectionId: null,
  title: "Buy milk",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  projectId: null,
  position: 1,
  labels: [],
  ...over,
});

describe("saved task views", () => {
  it("accepts the filters Tasks offers and refuses anything else", () => {
    expect(taskViewSchema.safeParse({ id: "tv-1", kind: "tasks", name: "Urgent home", filter: { projectId: "p1", labelId: "l1", priority: 1, due: "today" } }).success).toBe(true);
    expect(taskViewSchema.safeParse({ id: "tv-1", kind: "tasks", name: "Any", filter: {} }).success).toBe(true);
    expect(taskViewSchema.safeParse({ id: "tv-1", kind: "tasks", name: "", filter: {} }).success).toBe(false);
    expect(taskViewSchema.safeParse({ id: "tv-1", kind: "tasks", name: "Bad", filter: { priority: 5 } }).success).toBe(false);
    expect(taskViewSchema.safeParse({ id: "tv-1", kind: "tasks", name: "Bad", filter: { due: "someday" } }).success).toBe(false);
    expect(taskViewSchema.safeParse({ id: "tv-1", kind: "tasks", name: "Bad", filter: { projectId: "p1", extra: true } }).success).toBe(false);
    expect(taskViewSchema.safeParse({ id: "tv-1", kind: "issues", name: "Mine", filter: {} }).success).toBe(false);
  });

  it("matches a project, Inbox, a label, a priority and a due window", () => {
    const today = "2026-10-13";
    expect(taskViewMatches(task({ projectId: "p1" }), { projectId: "p1" }, today)).toBe(true);
    expect(taskViewMatches(task({ projectId: "p2" }), { projectId: "p1" }, today)).toBe(false);
    expect(taskViewMatches(task(), { projectId: "none" }, today)).toBe(true);
    expect(taskViewMatches(task({ projectId: "p1" }), { projectId: "none" }, today)).toBe(false);
    expect(taskViewMatches(task(), {}, today)).toBe(true);

    expect(taskViewMatches(task({ labels: ["l1", "l2"] }), { labelId: "l2" }, today)).toBe(true);
    expect(taskViewMatches(task({ labels: ["l1"] }), { labelId: "l2" }, today)).toBe(false);
    expect(taskViewMatches(task({ priority: 2 }), { priority: 2 }, today)).toBe(true);
    expect(taskViewMatches(task({ priority: 2 }), { priority: 1 }, today)).toBe(false);

    expect(taskViewMatches(task({ dueDate: "2026-10-12" }), { due: "overdue" }, today)).toBe(true);
    expect(taskViewMatches(task({ dueDate: "2026-10-13" }), { due: "overdue" }, today)).toBe(false);
    expect(taskViewMatches(task({ dueDate: "2026-10-13" }), { due: "today" }, today)).toBe(true);
    expect(taskViewMatches(task({ dueDate: "2026-10-20" }), { due: "upcoming" }, today)).toBe(true);
    expect(taskViewMatches(task({ dueDate: "2026-10-27" }), { due: "upcoming" }, today)).toBe(false);
    expect(taskViewMatches(task({ dueDate: "2026-10-13" }), { due: "upcoming" }, today)).toBe(true);
    expect(taskViewMatches(task(), { due: "none" }, today)).toBe(true);
    expect(taskViewMatches(task({ dueDate: "2026-10-13" }), { due: "none" }, today)).toBe(false);
    expect(taskViewMatches(task({ dueDate: "2026-10-13" }), { due: "any" }, today)).toBe(true);
  });

  it("lists sub-tasks everywhere except in the Inbox view", () => {
    expect(taskViewShowsSubtasks({ projectId: "none" })).toBe(false);
    expect(taskViewShowsSubtasks({ projectId: "p1" })).toBe(true);
    expect(taskViewShowsSubtasks({})).toBe(true);
  });

  it("combines its filters and prefills the project it names", () => {
    const today = "2026-10-13";
    expect(taskViewMatches(task({ projectId: "p1", labels: ["l1"], priority: 1, dueDate: "2026-10-13" }), { projectId: "p1", labelId: "l1", priority: 1, due: "today" }, today)).toBe(true);
    expect(taskViewMatches(task({ projectId: "p1", labels: ["l1"], priority: 1, dueDate: "2026-10-14" }), { projectId: "p1", labelId: "l1", priority: 1, due: "today" }, today)).toBe(false);
    expect(taskViewPrefill({ projectId: "p1" })).toEqual({ projectId: "p1" });
    expect(taskViewPrefill({ projectId: "none" })).toEqual({ projectId: null });
    expect(taskViewPrefill({})).toEqual({ projectId: null });
  });
});
