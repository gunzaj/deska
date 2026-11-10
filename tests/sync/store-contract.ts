// What every sync store must do the same (v5 4.4): the rules the sync relies
// on, run against MemoryStore (store-contract.test.ts) and PostgresStore
// (store-contract.pg.test.ts). A rule that holds in only one of them means the
// sync tests no longer cover production behaviour.
import { beforeEach, describe, expect, it } from "vitest";
import type { ImportStore } from "@/lib/sync/import";
import type { ReadModel } from "@/lib/sync/read-model";
import { partialSnapshot, type SnapshotProjectItem } from "@/lib/sync/types";
import { fixtureSnapshot } from "../fixtures/github";

export type ContractStore = ImportStore & { importSnapshot: ImportStore["importSnapshot"] };
/** `changes`: the recorded field history (F0) as issue node ID and field. */
export type ContractSetup = { store: ContractStore; read: () => Promise<ReadModel>; changes: () => Promise<{ issueNodeId: string; field: string }[]> };

const item = (itemId: string, issueNodeId: string, updatedAt?: string): SnapshotProjectItem => ({
  itemId,
  issueNodeId,
  statusOpt: "a0000002",
  priorityOpt: null,

  releaseIter: null,
  ...(updatedAt ? { updatedAt } : {}),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `setup` returns a fresh, empty store each time it is called. */
export function storeContract(label: string, setup: () => Promise<ContractSetup>) {
  describe(`${label}: sync store contract`, () => {
    let s: ContractSetup;
    beforeEach(async () => {
      s = await setup();
      await s.store.importSnapshot(fixtureSnapshot());
    });
    const itemsOf = async (issueNodeId: string) => [...(await s.read()).projectItems.values()].filter((p) => p.issueNodeId === issueNodeId).map((p) => p.itemId);

    it("importing the same snapshot again inserts and updates nothing", async () => {
      const again = await s.store.importSnapshot(fixtureSnapshot());
      expect(again).toMatchObject({ inserted: 0, updated: 0 });
    });

    it("skips project items whose issue is not cached", async () => {
      await s.store.importSnapshot(partialSnapshot({ projectItems: [item("PVTI_elsewhere", "I_not_cached")] }));
      expect((await s.read()).projectItems.has("PVTI_elsewhere")).toBe(false);
    });

    it("keeps one item per issue: the more recently updated one wins", async () => {
      await s.store.importSnapshot(partialSnapshot({ projectItems: [item("PVTI_a", "I_bug", "2026-10-01T00:00:00Z")] }));
      expect(await itemsOf("I_bug")).toEqual(["PVTI_a"]);
      await s.store.importSnapshot(partialSnapshot({ projectItems: [item("PVTI_b", "I_bug", "2026-10-02T00:00:00Z")] }));
      expect(await itemsOf("I_bug")).toEqual(["PVTI_b"]);
      // An older one arriving late does not displace it.
      await s.store.importSnapshot(partialSnapshot({ projectItems: [item("PVTI_old", "I_bug", "2026-09-01T00:00:00Z")] }));
      expect(await itemsOf("I_bug")).toEqual(["PVTI_b"]);
    });

    it("a stale issue payload changes nothing: row, labels, assignees, parent or history (v5 2.1)", async () => {
      const issue = fixtureSnapshot().issues.find((i) => i.nodeId === "I_sub")!;
      await s.store.importSnapshot(partialSnapshot({ issues: [{ ...issue, updatedAt: "2026-10-12T10:00:00Z" }] }));
      const before = (await s.read()).issues.get("I_sub")!;
      const history = (await s.changes()).length;
      await s.store.importSnapshot(
        partialSnapshot({
          issues: [{ ...issue, updatedAt: "2026-10-12T09:00:00Z", state: "closed", labelIds: ["LA_1"], assigneeIds: ["U_1"], parentNodeId: null }],
        }),
      );
      const after = (await s.read()).issues.get("I_sub")!;
      expect({ state: after.state, labels: after.labelIds, assignees: after.assigneeIds, parent: after.parentNodeId }).toEqual({
        state: before.state,
        labels: before.labelIds,
        assignees: before.assigneeIds,
        parent: "I_epic",
      });
      expect(await s.changes()).toHaveLength(history);
    });

    it("a stale project item payload records no history (v5 2.1)", async () => {
      const current = fixtureSnapshot().projectItems.find((p) => p.issueNodeId === "I_epic")!;
      await s.store.importSnapshot(partialSnapshot({ projectItems: [{ ...current, updatedAt: "2026-10-12T10:00:00Z" }] }));
      const history = (await s.changes()).length;
      await s.store.importSnapshot(
        partialSnapshot({ projectItems: [{ ...current, statusOpt: "a0000006", priorityOpt: null, dims: {}, updatedAt: "2026-10-12T09:00:00Z" }] }),
      );
      expect((await s.read()).projectItems.get(current.itemId)).toMatchObject({ statusOpt: current.statusOpt, priorityOpt: current.priorityOpt });
      expect(await s.changes()).toHaveLength(history);
    });

    it("a scan's prune removes unseen items and keeps the seen ones", async () => {
      const before = [...(await s.read()).projectItems.values()];
      expect(before.length).toBeGreaterThan(1);
      const [kept] = before;
      await sleep(5);
      await s.store.resetScanSeen?.();
      await s.store.importSnapshot(partialSnapshot({ projectItems: [kept!] }), { scanId: "scan-1" });
      await sleep(5);
      const removed = await s.store.pruneUnseenProjectItems("scan-1", new Date().toISOString());
      expect(removed).toBe(before.length - 1);
      expect([...(await s.read()).projectItems.keys()]).toEqual([kept!.itemId]);
    });

    it("a prune keeps an item written after the scan began (v5 1.4)", async () => {
      const [first, second] = [...(await s.read()).projectItems.values()];
      await sleep(5);
      const startedAt = new Date().toISOString();
      await sleep(5);
      await s.store.resetScanSeen?.();
      await s.store.importSnapshot(partialSnapshot({ projectItems: [first!] }), { scanId: "scan-2" });
      // The second item is rewritten mid-scan; the scan never listed it.
      await s.store.importSnapshot(partialSnapshot({ projectItems: [{ ...second!, statusOpt: "changed-mid-scan" }] }));
      await s.store.pruneUnseenProjectItems("scan-2", startedAt);
      const left = (await s.read()).projectItems;
      expect(left.has(first!.itemId)).toBe(true);
      expect(left.has(second!.itemId)).toBe(true);
    });
  });
}
