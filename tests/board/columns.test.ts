import { describe, expect, it } from "vitest";
import { buildBoard } from "@/lib/board/board";
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
});
