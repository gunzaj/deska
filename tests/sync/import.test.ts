import { describe, expect, it } from "vitest";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { fixtureSnapshot } from "../fixtures/github";

describe("sync:full import (M2)", () => {
  it("imports the expected rows and excludes PRs", async () => {
    const store = new MemoryStore();
    const stats = await await importFull(fixtureSnapshot(), store);
    expect(stats.inserted).toBeGreaterThan(0);
    expect(stats.updated).toBe(0);
    expect(store.issueCount).toBe(3); // PR excluded
    expect(store.issues.has("I_pr")).toBe(false);
    expect(store.fields.size).toBe(4);
    expect(store.issueTypes.size).toBe(3);
    expect(store.labels.size).toBe(2);
    expect(store.projectItems.size).toBe(3);
    // parent link preserved
    expect(store.issues.get("I_sub")?.parentNodeId).toBe("I_epic");
  });

  it("second run makes no changes (idempotent)", async () => {
    const store = new MemoryStore();
    await await importFull(fixtureSnapshot(), store);
    const again = await await importFull(fixtureSnapshot(), store);
    expect(again).toEqual({ inserted: 0, updated: 0, unchanged: expect.any(Number) });
    expect(again.unchanged).toBeGreaterThan(0);
  });

  it("renaming an option updates the name and keeps the ID", async () => {
    const store = new MemoryStore();
    await await importFull(fixtureSnapshot(), store);
    const renamed = fixtureSnapshot();
    const status = renamed.fields.find((f) => f.name === "Status");
    status!.options![0]!.name = "🎯 Todo (renamed)";
    const stats = await importFull(renamed, store);
    expect(stats.updated).toBe(1);
    expect(stats.inserted).toBe(0);
    const opts = store.fields.get("PVTSSF_acme_status")!.options;
    expect(opts[0]).toMatchObject({ id: "a0000001", name: "🎯 Todo (renamed)" });
  });
});
