import { describe, expect, it } from "vitest";
import { importFull } from "@/lib/sync/import";
import { pollOnce, MapKv, type SyncSource } from "@/lib/sync/poll";
import { MemoryStore } from "@/lib/sync/store-memory";
import type { SnapshotIssue } from "@/lib/sync/types";
import { fixtureSnapshot } from "../fixtures/github";

// An incremental REST payload: native issue type and parent link are absent,
// labels/assignees are reported by name/login, milestone by number.
function restUpdate(over: Partial<SnapshotIssue> = {}): SnapshotIssue {
  return {
    nodeId: "I_epic",
    number: 100,
    title: "Epic: dashboard overhaul",
    body: "Parent epic",
    state: "open",
    stateReason: null,
    milestoneId: "M_1",
    authorLogin: "alice",
    url: "https://github.com/acme/widgets/issues/100",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-10-09T00:00:00Z",
    closedAt: null,
    labelIds: ["LA_1"],
    assigneeIds: ["U_1"],
    ...over,
  };
}

function sourceOf(check: Awaited<ReturnType<SyncSource["checkChanges"]>>): SyncSource {
  return { checkChanges: async () => check };
}

/** A KV after the initial import: polls only run from a cursor (S2). */
function cursorKv(): MapKv {
  const kv = new MapKv();
  kv.set("issues.since", "2026-10-01T00:00:00Z");
  return kv;
}

async function seeded() {
  const store = new MemoryStore();
  await importFull(fixtureSnapshot(), store);
  return store;
}

describe("incremental sync must not wipe fields REST cannot report", () => {
  it("preserves typeId and parentNodeId when the payload omits them", async () => {
    const store = await seeded();
    await pollOnce(
      sourceOf({
        kind: "changed",
        issues: [restUpdate()],
        items: [],
        etag: "e1",
        since: "2026-10-09T00:00:00Z",
      }),
      store,
      cursorKv(),
      "2026-10-09T12:00:00Z",
    );
    const epic = store.issues.get("I_epic")!;
    // Regression: these used to be overwritten with null on every poll.
    expect(epic.typeId).toBe("IT_acme_feature");
    expect(epic.milestoneId).toBe("M_1");

    const sub = store.issues.get("I_sub")!;
    expect(sub.parentNodeId).toBe("I_epic");
    expect(sub.typeId).toBe("IT_acme_task");
  });

  it("still applies a label removal, because labelIds is always present", async () => {
    const store = await seeded();
    expect(store.issues.get("I_epic")!.labelIds).toEqual(["LA_1"]);
    await pollOnce(
      sourceOf({
        kind: "changed",
        issues: [restUpdate({ labelIds: [] })],
        items: [],
        etag: "e1",
        since: "2026-10-09T00:00:00Z",
      }),
      store,
      cursorKv(),
      "2026-10-09T12:00:00Z",
    );
    expect(store.issues.get("I_epic")!.labelIds).toEqual([]);
  });

  it("honours an explicit null parent (sub-issue detached upstream)", async () => {
    const store = await seeded();
    await pollOnce(
      sourceOf({
        kind: "changed",
        issues: [
          restUpdate({
            nodeId: "I_sub",
            number: 101,
            title: "Sub: dashboard widget",
            parentNodeId: null,
          }),
        ],
        items: [],
        etag: "e1",
        since: "2026-10-09T00:00:00Z",
      }),
      store,
      cursorKv(),
      "2026-10-09T12:00:00Z",
    );
    expect(store.issues.get("I_sub")!.parentNodeId).toBeNull();
  });
});

describe("IdResolver maps REST identities onto store IDs", () => {
  it("reuses discovered IDs and mints stable provisional ones", async () => {
    const store = await seeded();
    // Already known from the full import.
    expect(store.labelId("UI")).toBe("LA_1");
    expect(store.userId("alice")).toBe("U_1");
    expect(store.milestoneId(12)).toBe("M_1");
    // Unknown: provisional but stable across calls.
    expect(store.labelId("brand new")).toBe("brand new");
    expect(store.labelId("brand new")).toBe("brand new");
    expect(store.userId("newbie")).toBe("newbie");
    // Unknown milestone: provisional "ms:<number>", stable across calls.
    expect(store.milestoneId(999)).toBe("ms:999");
    expect(store.milestoneId(999)).toBe("ms:999");
  });

  it("re-keys a provisional milestone reference to the real node ID", async () => {
    const store = await seeded();
    const provisional = store.milestoneId(999)!;
    store.upsertIssue(restUpdate({ milestoneId: provisional }));
    expect(store.issues.get("I_epic")!.milestoneId).toBe(provisional);
    store.upsertMilestone({ id: "M_new", number: 999, title: "v9", state: "open", dueOn: null });
    expect(store.issues.get("I_epic")!.milestoneId).toBe("M_new");
  });

  it("matches case-insensitively, as GitHub logins and labels are", async () => {
    const store = await seeded();
    expect(store.userId("ALICE")).toBe("U_1");
    expect(store.labelId("ui")).toBe("LA_1");
  });

  it("re-keys references when a provisional ID later gets a real node ID", async () => {
    const store = await seeded();
    const provisional = store.labelId("brand new");
    store.upsertIssue(restUpdate({ labelIds: [...["LA_1"], provisional] }));
    expect(store.issues.get("I_epic")!.labelIds).toContain(provisional);

    store.upsertLabel({ id: "LA_3", name: "brand new", color: "red", description: "" });

    expect(store.labels.has(provisional)).toBe(false);
    expect(store.labelId("brand new")).toBe("LA_3");
    expect(store.issues.get("I_epic")!.labelIds).toContain("LA_3");
    expect(store.issues.get("I_epic")!.labelIds).not.toContain(provisional);
  });

  it("re-keys assignee references the same way", async () => {
    const store = await seeded();
    const provisional = store.userId("newbie");
    store.upsertIssue(restUpdate({ assigneeIds: [provisional] }));
    store.upsertGhUser({ githubId: "U_99", login: "newbie", avatarUrl: null });
    expect(store.userId("newbie")).toBe("U_99");
    expect(store.issues.get("I_epic")!.assigneeIds).toEqual(["U_99"]);
  });
});