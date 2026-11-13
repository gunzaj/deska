import { describe, expect, it } from "vitest";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { buildBoard } from "@/lib/board/board";
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

  it("resolves the current release by date (core board default)", async () => {
    const { store } = await setup();
    expect(resolveRelease(store, "current", "2026-10-09T00:00:00Z")).toBe("e0000023");
  });

  it("outside every iteration: no current release, next and previous by date (§4.1)", async () => {
    const { store } = await setup();
    const sprint = store.fields.get(store.projectFieldMap().sprint!.id)!;
    const sorted = [...sprint.iterations].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const before = new Date(Date.parse(first.startDate) - 86_400_000).toISOString();
    const after = new Date(Date.parse(last.startDate) + (last.duration + 1) * 86_400_000).toISOString();
    expect(resolveRelease(store, "current", before)).toBeNull();
    expect(resolveRelease(store, "next", before)).toBe(first.id);
    expect(resolveRelease(store, "previous", before)).toBeNull();
    expect(resolveRelease(store, "current", after)).toBeNull();
    expect(resolveRelease(store, "previous", after)).toBe(last.id);
    expect(resolveRelease(store, "next", after)).toBeNull();
  });
});
