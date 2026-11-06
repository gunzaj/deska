import { describe, expect, it } from "vitest";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { fixtureSnapshot } from "../fixtures/github";

describe("field change history in the memory store (F0)", () => {
  it("initial import writes nothing; a changed Release writes one row; a repeat writes none", async () => {
    const store = new MemoryStore();
    const snapshot = fixtureSnapshot();
    await importFull(snapshot, store);
    expect(store.fieldChanges).toEqual([]);
    const target = snapshot.projectItems[0]!;
    const other = (snapshot.fields.find((f) => f.name === "Release")?.iterations ?? []).find((r) => r.id !== target.releaseIter)!.id;
    const moved = { ...snapshot, projectItems: snapshot.projectItems.map((p) => (p === target ? { ...p, releaseIter: other } : p)) };
    await importFull(moved, store);
    expect(store.fieldChanges).toHaveLength(1);
    expect(store.fieldChanges[0]).toMatchObject({ issueNodeId: target.issueNodeId, field: "release", oldValue: target.releaseIter, newValue: other, source: "sync" });
    await importFull(moved, store);
    expect(store.fieldChanges).toHaveLength(1);
  });
});
