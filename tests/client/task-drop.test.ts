import { describe, expect, it } from "vitest";
import { dropOutcome, needsEditRights } from "@/lib/client/task-drop";

const task = (over: Partial<{ projectId: string | null; dueDate: string | null }> = {}) => ({ projectId: null, dueDate: null, ...over });
const TODAY = "2026-10-13";

describe("dropping a task on the sidebar", () => {
  it("a project files it, and undo puts it back", () => {
    const out = dropOutcome(task({ projectId: "p1" }), [], { kind: "project", id: "p2", name: "Website" }, TODAY)!;
    expect(out.patch).toEqual({ projectId: "p2" });
    expect(out.undo).toEqual({ projectId: "p1" });
    expect(out.message).toBe("Moved to Website");
    expect(dropOutcome(task({ projectId: "p2" }), [], { kind: "project", id: "p2", name: "Website" }, TODAY)).toBeNull();
  });

  it("Inbox clears the project", () => {
    expect(dropOutcome(task({ projectId: "p1" }), [], { kind: "inbox" }, TODAY)!.patch).toEqual({ projectId: null });
    expect(dropOutcome(task(), [], { kind: "inbox" }, TODAY)).toBeNull();
  });

  it("Today sets today's date; Upcoming sets tomorrow unless it is already later", () => {
    expect(dropOutcome(task({ dueDate: "2026-10-01" }), [], { kind: "today" }, TODAY)!.patch).toEqual({ dueDate: TODAY });
    expect(dropOutcome(task({ dueDate: TODAY }), [], { kind: "today" }, TODAY)).toBeNull();
    expect(dropOutcome(task(), [], { kind: "upcoming" }, TODAY)!.patch).toEqual({ dueDate: "2026-10-14" });
    expect(dropOutcome(task({ dueDate: "2026-10-20" }), [], { kind: "upcoming" }, TODAY)).toBeNull();
    expect(dropOutcome(task({ dueDate: TODAY }), [], { kind: "upcoming" }, TODAY)!.undo).toEqual({ dueDate: TODAY });
  });

  it("a label is added once, case-insensitively", () => {
    expect(dropOutcome(task(), ["ui"], { kind: "label", name: "bug" }, TODAY)!.patch).toEqual({ labels: ["ui", "bug"] });
    expect(dropOutcome(task(), ["UI"], { kind: "label", name: "ui" }, TODAY)).toBeNull();
  });

  it("only dates need edit rights (filing and labels are the viewer's own)", () => {
    expect([needsEditRights({ kind: "today" }), needsEditRights({ kind: "upcoming" }), needsEditRights({ kind: "inbox" }), needsEditRights({ kind: "label", name: "x" })]).toEqual([true, true, false, false]);
  });
});
