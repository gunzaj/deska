import { describe, expect, it } from "vitest";
import { boardMove, NO_VALUE } from "@/lib/client/board-move";
import type { ClientIssue } from "@/lib/client/types";

const issue = { assignees: ["Alice"] } as unknown as ClientIssue;

describe("boardMove", () => {
  it("sets the column's option, or clears it on the No-value column", () => {
    expect(boardMove(issue, "status", "a", "b")).toEqual({ field: "status", next: "b" });
    expect(boardMove(issue, "release", "r1", NO_VALUE)).toEqual({ field: "release", next: null });
    expect(boardMove(issue, "priority", "a", "a")).toBeNull();
  });
  it("moves one assignee between columns", () => {
    expect(boardMove(issue, "assignee", "alice", "bob")).toEqual({ field: "assignees", next: { added: ["bob"], removed: ["Alice"] } });
    expect(boardMove(issue, "assignee", NO_VALUE, "bob")).toEqual({ field: "assignees", next: { added: ["bob"], removed: [] } });
    expect(boardMove(issue, "assignee", "alice", NO_VALUE)).toEqual({ field: "assignees", next: { added: [], removed: ["Alice"] } });
  });
});
