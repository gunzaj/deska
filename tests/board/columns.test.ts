import { describe, expect, it } from "vitest";
import { moveCard, buildBoard } from "@/lib/board/board";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { buildViewRows } from "@/lib/views/rows";
import { fixtureSnapshot } from "../fixtures/github";

describe("board columns follow the field being displayed", () => {
  async function rows() {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(), store);
    return { store, all: buildViewRows(store) };
  }

  it("builds columns for whichever field is requested", async () => {
    const { store, all } = await rows();
    const byStatus = buildBoard(all, store, "status");
    expect(byStatus.find((c) => c.optionId === "a0000001")?.cards.map((r) => r.nodeId)).toEqual([
      "I_epic",
    ]);

    const byPriority = buildBoard(all, store, "priority");
    expect(
      byPriority.find((c) => c.optionId === "b0000003")?.cards.map((r) => r.nodeId),
    ).toEqual(["I_epic"]);
  });

  it("moveCard returns the descriptor for the requested field", async () => {
    const { all } = await rows();
    const epic = all.find((r) => r.nodeId === "I_epic")!;

    // Regression: the client hardcoded boardField:"status", so dragging on a
    // priority board would have written a priority option id into Status.
    expect(
      moveCard(epic, { columnOptionId: "b0000001", boardField: "priority" }, null),
    ).toEqual({ field: "priority", next: "b0000001" });

    expect(moveCard(epic, { columnOptionId: "a0000002", boardField: "status" }, null)).toEqual({
      field: "status",
      next: "a0000002",
    });
  });

  it("treats a drop on the current value as a no-op", async () => {
    const { all } = await rows();
    const epic = all.find((r) => r.nodeId === "I_epic")!;
    expect(moveCard(epic, { columnOptionId: "a0000001", boardField: "status" }, null)).toBeNull();
  });

  it("assigns a Release when a card without one is dropped on the board", async () => {
    const { all } = await rows();
    const noRelease = all.find((r) => r.nodeId === "I_sub")!;
    expect(noRelease.releaseId).toBeNull();
    expect(moveCard(noRelease, { columnOptionId: null, boardField: "status" }, "e0000023")).toEqual({
      field: "release",
      next: "e0000023",
    });
  });
});
