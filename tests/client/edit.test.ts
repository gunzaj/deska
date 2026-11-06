// W2: the browser side of an issue edit.
import { describe, expect, it } from "vitest";
import { applyWire, editRequest, wireBefore, wirePatch } from "@/lib/client/edit";
import type { ClientIssue, WireIssue } from "@/lib/client/types";

const w: WireIssue = { id: "I_1", n: 1, t: "x", o: 1, au: "a", c: "", u: "", pr: "p_low", lb: ["L1"], as: ["Alice"] };

describe("wire patches", () => {
  it("sets and clears single values", () => {
    expect(wirePatch(w, "priority", "p_high")).toEqual({ pr: "p_high" });
    const cleared = applyWire(w, wirePatch(w, "priority", null));
    expect("pr" in cleared).toBe(false);
    expect(wireBefore(w, { pr: "p_high" })).toEqual({ pr: "p_low" });
  });

  it("applies label and assignee deltas (logins case-insensitively)", () => {
    expect(wirePatch(w, "labels", { added: ["L2"], removed: ["L1"] })).toEqual({ lb: ["L2"] });
    expect(wirePatch(w, "labels", { added: [], removed: ["L1"] })).toEqual({ lb: undefined });
    expect(wirePatch(w, "assignees", { added: ["bob", "alice"], removed: [] })).toEqual({ as: ["Alice", "bob"] });
    expect(wirePatch(w, "assignees", { added: [], removed: ["alice"] })).toEqual({ as: undefined });
  });

  it("closes and reopens", () => {
    expect(wirePatch(w, "state", "closed")).toEqual({ o: 0 });
    expect(wirePatch({ ...w, o: 0 }, "state", "open")).toEqual({ o: 1 });
  });
});

describe("edit requests", () => {
  const issue = { priorityId: "p_low", state: "open", labelIds: ["L1"] } as unknown as ClientIssue;
  it("single values carry the base the user saw; deltas carry none", () => {
    expect(editRequest(issue, "priority", "p_high", "k")).toEqual({ field: "priority", base: "p_low", next: "p_high", idempotencyKey: "k" });
    expect(editRequest(issue, "labels", { added: ["L2"], removed: [] }, "k")).toEqual({ field: "labels", next: { added: ["L2"], removed: [] }, idempotencyKey: "k" });
    expect(editRequest(issue, "state", "closed", "k")).toMatchObject({ base: "open" });
  });
});
