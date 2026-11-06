// v5 1.3: one discovered field map, carried by field ID through sync, writes
// and the read model. R3 only fixed the initial import; a renamed "Release"
// used to blank every item on the next scan and break edits, close and the board.
import { describe, expect, it, vi } from "vitest";
import { buildBoard } from "@/lib/board/board";
import { buildClientData } from "@/lib/client/build";
import { submitEdit } from "@/lib/outbox/edit";
import type { ProcessDeps } from "@/lib/outbox/store";
import { doneStatusOption } from "@/lib/outbox/runtime";
import { refreshFieldMap, resolveFieldMap, EMPTY_FIELD_MAP, FIELD_MAP_KEY, parseFieldMap, type ProjectFieldMap } from "@/lib/sync/field-map";
import { scanProject, refreshSourceFields } from "@/lib/sync/cycle";
import { importFull } from "@/lib/sync/import";
import { MapKv } from "@/lib/sync/poll";
import { applyFieldValues } from "@/lib/sync/source-github";
import { MemoryStore } from "@/lib/sync/store-memory";
import type { SnapshotProjectItem } from "@/lib/sync/types";
import { buildViewRows, resolveRelease } from "@/lib/views/rows";
import { fixtureSnapshot } from "../fixtures/github";

vi.mock("@/lib/outbox/store", () => ({
  enqueueEdit: vi.fn(async (e: Record<string, unknown>) => ({ id: "e1", status: "pending", ...e })),
  processEdit: vi.fn(async () => undefined),
}));

const STATUS = "PVTSSF_acme_status";
const RELEASE = "PVTIF_acme_release";
const NOW = new Date("2026-10-16T10:00:00Z");

const fields = (names: string[], dataTypes: Record<string, string> = {}) =>
  names.map((name) => ({ id: `F_${name}`, name, dataType: dataTypes[name] ?? "SINGLE_SELECT" }));
const emptyItem = (): SnapshotProjectItem => ({ itemId: "x", issueNodeId: "i", statusOpt: null, priorityOpt: null, teamOpt: null, platformOpt: null, releaseIter: null });

/** The fixtures with Release renamed "Sprint" and Status renamed "Stage". */
function renamed() {
  const snapshot = fixtureSnapshot(NOW);
  snapshot.fields = snapshot.fields.map((f) => (f.id === RELEASE ? { ...f, name: "Sprint" } : f.id === STATUS ? { ...f, name: "Stage" } : f));
  return snapshot;
}

describe("resolveFieldMap", () => {
  it("maps each logical key to the discovered field, case-insensitively", () => {
    const map = resolveFieldMap(fields(["status", "Priority", "Team", "Platform", "Release"], { Release: "ITERATION" }), null, {});
    expect(map.status).toEqual({ id: "F_status", name: "status" });
    expect(map.release).toEqual({ id: "F_Release", name: "Release" });
  });

  it("follows a Release field renamed to something else when it is the sole iteration field", () => {
    const map = resolveFieldMap(fields(["Status", "Sprint"], { Sprint: "ITERATION" }), null, {});
    expect(map.release).toEqual({ id: "F_Sprint", name: "Sprint" });
    expect(map.priority).toBeNull();
  });

  it("keeps a pinned field by ID when it is renamed, even if another field now has the old name", () => {
    const before = resolveFieldMap(fields(["Status", "Release"], { Release: "ITERATION" }), null, {});
    const after = [
      { id: "F_Status", name: "Status", dataType: "SINGLE_SELECT" },
      { id: "F_Release", name: "Sprint", dataType: "ITERATION" },
      { id: "F_Other", name: "Release", dataType: "ITERATION" },
    ];
    expect(resolveFieldMap(after, before, {}).release).toEqual({ id: "F_Release", name: "Sprint" });
  });

  it("lets a PROJECT_*_FIELD override win and leaves unmatched keys null", () => {
    const map = resolveFieldMap(fields(["Status", "Stage"]), null, { PROJECT_STATUS_FIELD: "Stage" });
    expect(map.status?.id).toBe("F_Stage");
    expect(resolveFieldMap([], null, {})).toEqual(EMPTY_FIELD_MAP);
  });

  it("stores the map in sync_state only when it changed", () => {
    const kv = new MapKv();
    const set = vi.spyOn(kv, "set");
    refreshFieldMap(kv, fields(["Status"]));
    refreshFieldMap(kv, fields(["Status"]));
    expect(set).toHaveBeenCalledTimes(1);
    expect(parseFieldMap(kv.get(FIELD_MAP_KEY))?.status?.id).toBe("F_Status");
  });
});

describe("applyFieldValues by field ID", () => {
  it("applies a value whose field was renamed", () => {
    const map = resolveFieldMap([{ id: "F_R", name: "Sprint", dataType: "ITERATION" }], null, {});
    const row = emptyItem();
    applyFieldValues(row, [{ iterationId: "it_1", field: { id: "F_R", name: "Sprint" } }], map);
    expect(row.releaseIter).toBe("it_1");
  });

  it("ignores another iteration field", () => {
    const map = resolveFieldMap([{ id: "F_R", name: "Release", dataType: "ITERATION" }], null, {});
    const row = emptyItem();
    applyFieldValues(row, [{ iterationId: "other", field: { id: "F_OTHER", name: "Release" } }], map);
    expect(row.releaseIter).toBeNull();
  });
});

describe("a renamed Release or Status field (R3, v5 1.3)", () => {
  it("an incremental project scan keeps values and records no phantom change", async () => {
    const kv = new MapKv();
    const store = new MemoryStore();
    const original = fixtureSnapshot(NOW);
    await importFull(original, store);
    refreshFieldMap(kv, original.fields); // the map pinned by the initial import
    await importFull(renamed(), store); // GitHub renames the fields; reconcile stores them
    const changesBefore = store.fieldChanges.length;

    // What GitHub returns for PVTI_1 (#100): the same values, under the new names.
    let map: ProjectFieldMap = EMPTY_FIELD_MAP;
    const source = {
      useFields: (m: ProjectFieldMap) => (map = m),
      scanProjectItems: async () => {
        const row: SnapshotProjectItem = { ...emptyItem(), itemId: "PVTI_1", issueNodeId: "I_epic" };
        applyFieldValues(
          row,
          [
            { iterationId: "e0000023", field: { id: RELEASE, name: "Sprint" } },
            { optionId: "a0000001", field: { id: STATUS, name: "Stage" } },
            { optionId: "b0000003", field: { id: "PVTSSF_acme_priority", name: "Priority" } },
            { optionId: "c0000001", field: { id: "PVTSSF_acme_team", name: "Team" } },
          ],
          map,
        );
        return { items: [row], nextCursor: null, total: 1 };
      },
    };
    await refreshSourceFields(source, store, kv);
    await scanProject(source, store, kv, "2026-10-16T12:00:00Z");

    const item = store.projectItems.get("PVTI_1")!;
    expect(item.releaseIter).toBe("e0000023");
    expect(item.statusOpt).toBe("a0000001");
    expect(store.fieldChanges.slice(changesBefore).filter((c) => c.newValue === null)).toEqual([]);
  });

  it("the read model, board and client data still resolve Release and Status", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(NOW), store);
    store.pinnedFieldMap = store.projectFieldMap();
    await importFull(renamed(), store);

    const rows = buildViewRows(store);
    expect(rows.find((r) => r.number === 100)).toMatchObject({ releaseName: "Sprint 23", statusName: "📋 To do" });
    expect(resolveRelease(store, "current", NOW.toISOString())).toBe("e0000023");
    expect(buildBoard(rows, store, "status").map((c) => c.name).slice(0, 3)).toEqual(["📋 To do", "🚧 In progress", "✅ Done"]);
    const data = buildClientData(store, { viewer: "alice", writeMode: true, demo: true, now: NOW });
    expect(data.meta.fields.status).toHaveLength(3);
    expect(data.meta.releases.map((r) => r.title)).toEqual(["Sprint 22", "Sprint 23"]);
  });

  it("an edit validates against the renamed fields and Close finds the done option", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(NOW), store);
    store.pinnedFieldMap = store.projectFieldMap();
    await importFull(renamed(), store);

    expect(doneStatusOption(store, "a0000006")).toEqual({ ok: true, id: "a0000006" });
    const edit = (field: "status" | "release", next: string) =>
      submitEdit({ viewer: "alice", token: "t", store, issueNodeId: "I_epic", body: { field, next }, deps: () => ({}) as ProcessDeps });
    expect((await edit("release", "e0000022")).status).not.toBe(400);
    expect((await edit("status", "a0000002")).status).not.toBe(400);
    expect((await edit("release", "nope")).status).toBe(400);
  });
});
