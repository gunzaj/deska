import { describe, expect, it } from "vitest";
import { newIssueUrl, searchTasks } from "@/lib/client/palette";
import type { Task } from "@/lib/tasks/model";

const task = (id: string, title: string, creator: string, assignee: string | null = null): Task =>
  ({ id, title, creator, assignee, completedAt: null, links: [], labels: [], position: 0, projectId: null }) as unknown as Task;

describe("palette sources (U5)", () => {
  it("builds the New issue link from the configured repo", () => {
    expect(newIssueUrl("acme/widgets")).toBe("https://github.com/acme/widgets/issues/new");
  });

  it("finds tasks by title, and never another user's task", () => {
    const tasks = [task("1", "Review fee PR", "alice"), task("2", "Review fee notes", "bob"), task("3", "Review fee docs", "bob", "alice"), task("4", "Other", "alice")];
    expect(searchTasks(tasks, "review fee", "alice").map((t) => t.id).sort()).toEqual(["1", "3"]);
    expect(searchTasks(tasks, "review fee", "someone-else")).toEqual([]);
    expect(searchTasks(tasks, "  ", "alice")).toEqual([]);
  });
});
