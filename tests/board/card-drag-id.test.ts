import { describe, expect, it } from "vitest";
import { boardMove, cardDragId } from "@/lib/client/board-move";
import type { ClientIssue } from "@/lib/client/types";

const twelve = { nodeId: "I_12", number: 12, assignees: ["alice", "bob"] } as unknown as ClientIssue;

describe("board card drag ids", () => {
  it("an issue with several assignees gets one draggable per column, and a drag leaves the column it started in", () => {
    // dnd-kit keeps one draggable per id: the last card registered wins.
    const registry = new Map<string, { issue: ClientIssue; fromKey: string }>();
    const cards = ["alice", "bob"].map((col) => ({ id: cardDragId(twelve.nodeId, col), data: { issue: twelve, fromKey: col } }));
    for (const c of cards) registry.set(c.id, c.data);
    expect(registry.size).toBe(2);
    // Drag #12 from alice's column to carol's.
    const d = registry.get(cards[0]!.id)!;
    expect(boardMove(d.issue, "assignee", d.fromKey, "carol")).toEqual({ field: "assignees", next: { added: ["carol"], removed: ["alice"] } });
  });
  it("keeps backlog cards on their prefix", () => {
    expect(cardDragId("I_1", null, "backlog:")).toBe("backlog:I_1");
    expect(cardDragId("I_1", "s1")).not.toBe(cardDragId("I_1", "s2"));
  });
});
