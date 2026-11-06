import { describe, expect, it } from "vitest";
import { bulkConfirmText, bulkEdit, describeChange, rangeIds } from "@/lib/client/bulk";
import type { ClientIssue } from "@/lib/client/types";

const issue = { priorityId: "low", statusId: null, teamId: null, platformId: null, releaseId: "r1", labelIds: ["L1"], assignees: ["Alice"] } as unknown as ClientIssue;

describe("bulk edit", () => {
  it("skips issues that already hold the value", () => {
    expect(bulkEdit(issue, { kind: "set", field: "priority", value: "high", valueLabel: "HIGH" })).toEqual({ field: "priority", next: "high" });
    expect(bulkEdit(issue, { kind: "set", field: "priority", value: "low", valueLabel: "LOW" })).toBeNull();
    expect(bulkEdit(issue, { kind: "set", field: "release", value: null, valueLabel: "" })).toEqual({ field: "release", next: null });
  });
  it("labels and assignees go as one-item deltas", () => {
    expect(bulkEdit(issue, { kind: "label", op: "add", id: "L2", name: "x" })).toEqual({ field: "labels", next: { added: ["L2"], removed: [] } });
    expect(bulkEdit(issue, { kind: "label", op: "add", id: "L1", name: "x" })).toBeNull();
    expect(bulkEdit(issue, { kind: "assignee", op: "remove", login: "alice" })).toEqual({ field: "assignees", next: { added: [], removed: ["alice"] } });
    expect(bulkEdit(issue, { kind: "assignee", op: "remove", login: "bob" })).toBeNull();
  });
  it("asks for confirmation over 50 issues, with the count and the change", () => {
    const c = { kind: "set", field: "priority", value: "high", valueLabel: "HIGH" } as const;
    expect(bulkConfirmText(c, 50)).toBeNull();
    expect(bulkConfirmText(c, 51)).toBe("Set Priority to HIGH on 51 issues?");
    expect(describeChange({ kind: "assignee", op: "add", login: "bob" })).toBe("Assign bob");
  });
  it("Shift+click selects the range in display order", () => {
    expect(rangeIds(["a", "b", "c", "d"], "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeIds(["a", "b", "c", "d"], "c", "a")).toEqual(["a", "b", "c"]);
    expect(rangeIds(["a", "b"], null, "b")).toEqual(["b"]);
  });
});
