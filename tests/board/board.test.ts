import { describe, expect, it } from "vitest";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { buildBoard, moveCard } from "@/lib/board/board";
import { buildViewRows, resolveRelease } from "@/lib/views/rows";
import { fixtureSnapshot } from "../fixtures/github";

async function setup() {
  const store = new MemoryStore();
  await await importFull(fixtureSnapshot(new Date("2026-10-09T00:00:00Z")), store);
  return { store, rows: buildViewRows(store) };
}

describe("release board (M7)", () => {
  it("builds status columns in GitHub option order with counts", async () => {
    const { store, rows } = await setup();
    const cols = buildBoard(rows, store, "status");
    expect(cols.map((c) => c.name)).toEqual(["📋 To do", "🚧 In progress", "✅ Done", "No value"]);
    expect(cols.find((c) => c.name === "📋 To do")?.cards.map((r) => r.number)).toEqual([100]);
    expect(cols.find((c) => c.name === "No value")?.cards.map((r) => r.number)).toEqual([102]);
  });

  it("a drag sets Status through the outbox descriptor", async () => {
    const { rows } = await setup();
    const card = rows.find((r) => r.number === 100)!;
    expect(moveCard(card, { columnOptionId: "a0000002", boardField: "status" }, "e0000023")).toEqual({
      field: "status",
      next: "a0000002",
    });
    expect(moveCard(card, { columnOptionId: "a0000001", boardField: "status" }, "e0000023")).toBeNull();
  });

  it("dragging a backlog card into the release sets Release", async () => {
    const { rows } = await setup();
    const backlogCard = rows.find((r) => r.number === 102)!; // no release
    expect(backlogCard.releaseId).toBeNull();
    expect(moveCard(backlogCard, { columnOptionId: "a0000001", boardField: "status" }, "e0000023")).toEqual({
      field: "release",
      next: "e0000023",
    });
  });

  it("resolves the current release by date (core board default)", async () => {
    const { store } = await setup();
    expect(resolveRelease(store, "current", "2026-10-09T00:00:00Z")).toBe("e0000023");
  });
});
