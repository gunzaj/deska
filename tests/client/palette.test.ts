import { describe, expect, it } from "vitest";
import { newIssueUrl, searchPrs, searchTasks } from "@/lib/client/palette";
import type { ClientPr } from "@/lib/client/types";
import type { Task } from "@/lib/tasks/model";

const task = (id: string, title: string, creator: string, assignee: string | null = null): Task =>
  ({ id, title, creator, assignee, completedAt: null, links: [], labels: [], position: 0, projectId: null }) as unknown as Task;

const pr = (number: number, title: string, state: ClientPr["state"] = "open"): ClientPr =>
  ({ nodeId: `PR_${number}`, number, title, state, updatedAt: "2026-10-01T00:00:00Z", author: "a", url: `https://github.com/x/y/pull/${number}` }) as unknown as ClientPr;

describe("palette sources (U5)", () => {
  it("builds the New issue link from the configured repo", () => {
    expect(newIssueUrl("acme/widgets")).toBe("https://github.com/acme/widgets/issues/new");
  });

  it("finds a PR by number and by title", () => {
    const prs = [pr(31, "Fix fee estimate"), pr(310, "Docs"), pr(7, "Refactor sync")];
    expect(searchPrs(prs, "#31")[0]!.number).toBe(31);
    expect(searchPrs(prs, "refactor").map((p) => p.number)).toEqual([7]);
    expect(searchPrs(prs, "nothing")).toEqual([]);
  });

  it("finds tasks by title, and never another user's task", () => {
    const tasks = [task("1", "Review fee PR", "alice"), task("2", "Review fee notes", "bob"), task("3", "Review fee docs", "bob", "alice"), task("4", "Other", "alice")];
    expect(searchTasks(tasks, "review fee", "alice").map((t) => t.id).sort()).toEqual(["1", "3"]);
    expect(searchTasks(tasks, "review fee", "someone-else")).toEqual([]);
    expect(searchTasks(tasks, "  ", "alice")).toEqual([]);
  });
});
