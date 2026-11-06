// v5 3.6: the read model is built in bulk, and builds the same model the import path does.
import { describe, expect, it } from "vitest";
import { demoSnapshot } from "@/lib/demo/generate";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { fixtureSnapshot } from "../fixtures/github";

const plain = (s: MemoryStore) => ({
  fields: [...s.fields],
  issueTypes: [...s.issueTypes],
  labels: [...s.labels],
  milestones: [...s.milestones],
  ghUsers: [...s.ghUsers],
  issues: [...s.issues],
  projectItems: [...s.projectItems],
  pullRequests: [...s.pullRequests],
  teams: [...s.teams],
});

describe("MemoryStore.loadSnapshot", () => {
  it.each([
    ["the fixtures", () => fixtureSnapshot()],
    ["the demo dataset", () => demoSnapshot(new Date("2026-10-16T12:00:00Z"))],
  ])("builds the same model as importing %s", async (_name, make) => {
    const imported = new MemoryStore();
    await importFull(make(), imported);
    const loaded = new MemoryStore();
    loaded.loadSnapshot(make());
    expect(plain(loaded)).toEqual(plain(imported));
    expect(loaded.fieldChanges).toEqual([]); // a read model records no history
  });

  it("keeps one item per issue and drops items of issues it does not hold", () => {
    const snap = fixtureSnapshot();
    const first = snap.projectItems[0]!;
    snap.projectItems = [first, { ...first, itemId: "PVTI_dup" }, { ...first, itemId: "PVTI_orphan", issueNodeId: "I_missing" }];
    const model = new MemoryStore();
    model.loadSnapshot(snap);
    expect([...model.projectItems.keys()]).toEqual([first.itemId]);
  });

  it("looks up an issue's item without scanning, and follows an item that moves to another issue", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(), store);
    const item = [...store.projectItems.values()].find((p) => p.issueNodeId === "I_epic")!;
    // The item ID now belongs to another issue: the old issue has no item left, so its fields read as cleared.
    await importFull({ ...fixtureSnapshot(), issues: [], projectItems: [{ ...item, issueNodeId: "I_bug", statusOpt: "a0000006" }], pullRequests: [] }, store);
    const moved = store.fieldChanges.filter((c) => c.issueNodeId === "I_bug" && c.field === "status");
    expect(moved.at(-1)).toMatchObject({ newValue: "a0000006" });
  });
});

describe("indexes on the read model (v5 3.8)", () => {
  it("find an issue by number and an issue's item without scanning", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(), store);
    expect(store.issueByNumber(101)?.nodeId).toBe("I_sub");
    expect(store.issueByNumber(99999)).toBeUndefined();
    expect(store.itemForIssue("I_epic")?.itemId).toBe("PVTI_1");
    expect(store.itemForIssue("I_pr")).toBeUndefined();

    const loaded = new MemoryStore();
    loaded.loadSnapshot(fixtureSnapshot());
    expect(loaded.issueByNumber(102)?.nodeId).toBe("I_bug");
    expect(loaded.itemForIssue("I_sub")?.itemId).toBe("PVTI_2");
  });

  it("follow an issue whose number changes", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(), store);
    const bug = fixtureSnapshot().issues.find((i) => i.nodeId === "I_bug")!;
    await importFull({ ...fixtureSnapshot(), issues: [{ ...bug, number: 777 }], projectItems: [], pullRequests: [] }, store);
    expect(store.issueByNumber(777)?.nodeId).toBe("I_bug");
    expect(store.issueByNumber(102)).toBeUndefined();
  });
});
