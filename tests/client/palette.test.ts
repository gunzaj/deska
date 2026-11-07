import { describe, expect, it } from "vitest";
import { newIssueUrl, searchTasks } from "@/lib/client/palette";
import type { Task } from "@/lib/tasks/model";

const task = (id: string, title: string): Task =>
  ({ id, title, completedAt: null, links: [], labels: [], position: 0, projectId: null }) as unknown as Task;

describe("palette sources (U5)", () => {
  it("builds the New issue link from the configured repo", () => {
    expect(newIssueUrl("acme/widgets")).toBe("https://github.com/acme/widgets/issues/new");
  });

  it("finds tasks by title", () => {
    const tasks = [task("1", "Review fee PR"), task("2", "Review fee notes"), task("3", "Other")];
    expect(searchTasks(tasks, "review fee").map((t) => t.id).sort()).toEqual(["1", "2"]);
    expect(searchTasks(tasks, "  ")).toEqual([]);
  });
});
