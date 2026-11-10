// SPEC §4.1 (D4): the field mapping is confirmed by the user and stored by
// field ID. Suggestions come from names and types; a renamed field stays
// mapped; a deleted one shows "Missing field — remap"; Priority rank follows
// the highest/lowest-first setting; dimensions are any other single-selects.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBoard } from "@/lib/board/board";
import { buildClientData } from "@/lib/client/build";
import { hydrate } from "@/lib/client/hydrate";
import { boardColumns, filterFields, groupIssues, runExplorer, sortOptions, sprintOn } from "@/lib/client/explorer";
import { altFixtureSnapshot, ALT } from "@/lib/demo/fixtures-alt";
import { submitEdit } from "@/lib/outbox/edit";
import type { ProcessDeps } from "@/lib/outbox/store";
import { doneStatusOption } from "@/lib/outbox/runtime";
import { resetSettingsCache, saveCloseDoneStatus, saveMapping } from "@/lib/settings";
import {
  dimKey,
  effectiveMapping,
  EMPTY_FIELD_MAP,
  missingFields,
  parseMapping,
  suggestFieldMap,
  suggestMapping,
  suggestPriorityOrder,
  validateMapping,
  type FieldMapping,
  type ProjectFieldMap,
} from "@/lib/sync/field-map";
import { scanProject, refreshSourceFields } from "@/lib/sync/cycle";
import { importFull } from "@/lib/sync/import";
import { MapKv } from "@/lib/sync/poll";
import { applyFieldValues } from "@/lib/sync/source-github";
import { MemoryStore } from "@/lib/sync/store-memory";
import type { SnapshotProjectItem } from "@/lib/sync/types";
import { trySeedViews } from "@/lib/views/seeds";
import { buildViewRows, resolveRelease } from "@/lib/views/rows";
import { fixtureSnapshot } from "../fixtures/github";

vi.mock("@/lib/outbox/store", () => ({
  enqueueEdit: vi.fn(async (e: Record<string, unknown>) => ({ id: "e1", status: "pending", ...e })),
  processEdit: vi.fn(async () => undefined),
}));

afterEach(() => resetSettingsCache());

const STATUS = "PVTSSF_acme_status";
const RELEASE = "PVTIF_acme_release";
const TEAM = "PVTSSF_acme_team";
const NOW = new Date("2026-10-16T10:00:00Z");

const fields = (names: string[], dataTypes: Record<string, string> = {}) =>
  names.map((name) => ({ id: `F_${name}`, name, dataType: dataTypes[name] ?? "SINGLE_SELECT" }));
const emptyItem = (): SnapshotProjectItem => ({ itemId: "x", issueNodeId: "i", statusOpt: null, priorityOpt: null, releaseIter: null });

/** The fixtures with Release renamed "Sprint", Status "Stage" and Team "Squad". */
function renamed() {
  const snapshot = fixtureSnapshot(NOW);
  const names: Record<string, string> = { [RELEASE]: "Sprint", [STATUS]: "Stage", [TEAM]: "Squad" };
  snapshot.fields = snapshot.fields.map((f) => (names[f.id] ? { ...f, name: names[f.id]! } : f));
  return snapshot;
}

async function storeOf(snapshot = fixtureSnapshot(NOW), mapping: FieldMapping | null = null) {
  const store = new MemoryStore();
  await importFull(snapshot, store);
  store.mapping = mapping;
  return store;
}

const client = (store: MemoryStore) => hydrate(buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: NOW }));

describe("suggestions by name and type", () => {
  it("maps the predecessor's names and makes every other single-select a dimension", () => {
    const map = suggestFieldMap(fields(["status", "Priority", "Team", "Platform", "Release"], { Release: "ITERATION" }), {});
    expect(map.status).toEqual({ id: "F_status", name: "status" });
    expect(map.priority?.id).toBe("F_Priority");
    expect(map.sprint).toEqual({ id: "F_Release", name: "Release" });
    expect(map.dimensions.map((d) => d.name)).toEqual(["Team", "Platform"]);
  });

  it("maps differently named fields by type and wording", () => {
    const snapshot = altFixtureSnapshot({ now: NOW });
    const m = suggestMapping(snapshot.fields, {});
    expect(m.status?.id).toBe(ALT.stage);
    expect(m.priority?.id).toBe(ALT.urgency);
    expect(m.sprint?.id).toBe(ALT.cycle);
    // The number field is neither a role nor a dimension.
    expect(m.dimensions.map((d) => d.id)).toEqual([ALT.squad, ALT.surface]);
    expect(m.priorityOrder).toBe("highest-first");
  });

  it("never maps a field of the wrong type, and falls back to the sole iteration field", () => {
    const map = suggestFieldMap(fields(["Status", "Sprint", "Cadence"], { Cadence: "ITERATION" }), {});
    // "Sprint" is a single-select here: it can't be the Sprint role.
    expect(map.sprint?.id).toBe("F_Cadence");
    expect(map.dimensions.map((d) => d.id)).toEqual(["F_Sprint"]);
    expect(suggestFieldMap([], {})).toEqual(EMPTY_FIELD_MAP);
  });

  it("lets a PROJECT_*_FIELD override win", () => {
    const map = suggestFieldMap(fields(["Status", "Phase"]), { PROJECT_STATUS_FIELD: "Phase" });
    expect(map.status?.id).toBe("F_Phase");
  });

  it("guesses which way round Priority options are", () => {
    expect(suggestPriorityOrder([{ name: "Low" }, { name: "Medium" }, { name: "High" }])).toBe("lowest-first");
    expect(suggestPriorityOrder([{ name: "🔥 Urgent" }, { name: "Normal" }, { name: "Low" }])).toBe("highest-first");
    expect(suggestPriorityOrder([{ name: "P0" }, { name: "P1" }])).toBe("highest-first");
    expect(suggestPriorityOrder([])).toBe("highest-first");
  });
});

describe("validation and storage", () => {
  const all = altFixtureSnapshot({ now: NOW }).fields;
  const good = suggestMapping(all, {});

  it("accepts the suggestion and round-trips through JSON", () => {
    expect(validateMapping(good, all)).toEqual([]);
    expect(parseMapping(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it("requires Status, the right types, no field twice, and done options of Status", () => {
    expect(validateMapping({ ...good, status: null }, all)).toContain("Choose the Status field.");
    expect(validateMapping({ ...good, sprint: { id: ALT.squad, name: "Squad" } }, all).join(" ")).toMatch(/not a iteration|already mapped/);
    expect(validateMapping({ ...good, dimensions: [...good.dimensions, { id: ALT.stage, name: "Stage" }] }, all).join(" ")).toMatch(/already mapped/);
    expect(validateMapping({ ...good, doneStatusIds: ["g0000001"] }, all)).toContain("Done options must be options of the Status field.");
    expect(validateMapping({ ...good, doneStatusIds: ["f0000003"] }, all)).toEqual([]);
  });
});

describe("a project with differently named fields, end to end (D4)", () => {
  it("rows, filters, grouping, board columns and sorting run on the mapping", async () => {
    const snapshot = altFixtureSnapshot({ now: NOW });
    const store = await storeOf(snapshot, suggestMapping(snapshot.fields, {}));
    const { meta, issues } = client(store);
    expect(meta.mapping.status?.name).toBe("Stage");
    expect(meta.dimensions.map((d) => [d.key, d.name])).toEqual([
      [dimKey(ALT.squad), "Squad"],
      [dimKey(ALT.surface), "Surface"],
    ]);
    const epic = issues.find((i) => i.number === 100)!;
    expect(epic).toMatchObject({ statusName: "Doing", priorityName: "P0", releaseName: "Sprint 23" });
    expect(epic.dims[ALT.squad]?.name).toBe("Falcons");

    // Filters: `dim:<fieldId>`, from the dimension's options.
    expect(filterFields(meta).map((f) => f.label)).toEqual(expect.arrayContaining(["Squad", "Surface", "Release"]));
    const falcons = runExplorer(issues, [{ field: dimKey(ALT.squad), op: "in", values: ["h0000001"] }], [], meta);
    expect(falcons.map((i) => i.number).sort()).toEqual([100, 102]);
    expect(runExplorer(issues, [{ field: dimKey(ALT.surface), op: "empty" }], [], meta).map((i) => i.number)).toEqual([101]);

    // Grouping and board columns: every option in project order, then "No value".
    expect(groupIssues(issues, dimKey(ALT.squad), meta).map((g) => g.label)).toEqual(["Falcons", "Otters"]);
    expect(boardColumns(issues, dimKey(ALT.surface), meta).map((c) => c.label)).toEqual(["Web", "API", "No Surface"]);
    expect(buildBoard(buildViewRows(store), store, dimKey(ALT.squad)).map((c) => c.name)).toEqual(["Falcons", "Otters"]);

    // Sort by a dimension and by Priority (P0 is the highest here).
    expect(sortOptions(meta).map((s) => s.key)).toContain(dimKey(ALT.squad));
    expect(runExplorer(issues, [], [{ field: "priority", dir: "desc" }], meta).map((i) => i.number)).toEqual([100, 102, 101]);

    // Seed views use the first dimension, never a name lookup.
    expect(trySeedViews(store).find((v) => v.id === "seed-release-teams")).toMatchObject({ name: "Current Release by Squad", groupBy: dimKey(ALT.squad) });
  });

  it("edits validate a dimension by field ID", async () => {
    const snapshot = altFixtureSnapshot({ now: NOW });
    const store = await storeOf(snapshot, suggestMapping(snapshot.fields, {}));
    const edit = (field: string, next: string) =>
      submitEdit({ viewer: "alice", token: "t", store, issueNodeId: "I_epic", body: { field: field as never, next }, deps: () => ({}) as ProcessDeps });
    expect((await edit(dimKey(ALT.squad), "h0000002")).status).not.toBe(400);
    expect((await edit(dimKey(ALT.squad), "k0000001")).status).toBe(400);
    expect((await edit("dim:F_unknown", "h0000002")).status).toBe(400);
  });
});

describe("no iteration field", () => {
  it("hides sprint features: no Release filter, grouping, sort, triage queue or seed view", async () => {
    const snapshot = altFixtureSnapshot({ sprint: false, now: NOW });
    const store = await storeOf(snapshot, suggestMapping(snapshot.fields, {}));
    const { meta } = client(store);
    expect(meta.mapping.sprint).toBeNull();
    expect(sprintOn(meta)).toBe(false);
    expect(meta.releases).toEqual([]);
    expect(filterFields(meta).map((f) => f.key)).not.toContain("release");
    expect(sortOptions(meta).map((s) => s.key)).not.toContain("release");
    const seeds = trySeedViews(store).map((v) => v.id);
    expect(seeds).not.toContain("seed-release-teams");
    expect(JSON.stringify(trySeedViews(store))).not.toContain('"release"');
  });
});

describe("Priority rank follows the highest/lowest-first setting", () => {
  it("lowest-first: the last option is the top priority", async () => {
    const store = await storeOf(fixtureSnapshot(NOW), { ...suggestMapping(fixtureSnapshot(NOW).fields, {}), priorityOrder: "lowest-first" });
    const { meta, issues } = client(store);
    expect(meta.fields.priority.map((o) => o.name)).toEqual(["Low", "Medium", "High"]);
    expect(runExplorer(issues, [], [{ field: "priority", dir: "desc" }], meta).map((i) => i.priorityName)).toEqual(["High", "Medium", null]);
    expect(buildViewRows(store).find((r) => r.number === 100)?.priorityRank).toBe(2);
  });

  it("highest-first: the same options, read the other way round", async () => {
    const store = await storeOf(fixtureSnapshot(NOW), { ...suggestMapping(fixtureSnapshot(NOW).fields, {}), priorityOrder: "highest-first" });
    const { meta, issues } = client(store);
    expect(meta.fields.priority.map((o) => o.name)).toEqual(["High", "Medium", "Low"]);
    // "Low" is now the first option, so the top priority: Medium outranks High.
    expect(runExplorer(issues, [], [{ field: "priority", dir: "desc" }], meta).map((i) => i.priorityName)).toEqual(["Medium", "High", null]);
    expect(groupIssues(issues, "priority", meta).map((g) => g.label)).toEqual(["Medium", "High", "No priority"]);
    expect(buildViewRows(store).find((r) => r.number === 100)?.priorityRank).toBe(0);
  });
});

describe("a renamed field stays mapped", () => {
  it("an incremental project scan keeps values and records no phantom change", async () => {
    const kv = new MapKv();
    const original = fixtureSnapshot(NOW);
    await saveMapping(suggestMapping(original.fields, {}));
    const store = await storeOf(original);
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
            { optionId: "c0000001", field: { id: TEAM, name: "Squad" } },
          ],
          map,
        );
        return { items: [row], nextCursor: null, total: 1 };
      },
    };
    await refreshSourceFields(source, store, kv);
    expect(map.status).toEqual({ id: STATUS, name: "Stage" });
    await scanProject(source, store, kv, "2026-10-16T12:00:00Z");

    const item = store.projectItems.get("PVTI_1")!;
    expect(item.releaseIter).toBe("e0000023");
    expect(item.statusOpt).toBe("a0000001");
    expect(item.dims?.[TEAM]).toBe("c0000001");
    expect(store.fieldChanges.slice(changesBefore)).toEqual([]);
  });

  it("the read model, board, client data and filters show the new names", async () => {
    const store = await storeOf(fixtureSnapshot(NOW), suggestMapping(fixtureSnapshot(NOW).fields, {}));
    await importFull(renamed(), store);

    const rows = buildViewRows(store);
    expect(rows.find((r) => r.number === 100)).toMatchObject({ releaseName: "Sprint 23", statusName: "📋 To do" });
    expect(resolveRelease(store, "current", NOW.toISOString())).toBe("e0000023");
    expect(buildBoard(rows, store, "status").map((c) => c.name).slice(0, 3)).toEqual(["📋 To do", "🚧 In progress", "✅ Done"]);
    const { meta, issues } = client(store);
    expect(meta.mapping.status).toEqual({ id: STATUS, name: "Stage", missing: false });
    expect(meta.mapping.sprint?.name).toBe("Sprint");
    expect(meta.dimensions.map((d) => d.name)).toEqual(["Squad"]);
    expect(filterFields(meta).find((f) => f.key === dimKey(TEAM))?.label).toBe("Squad");
    expect(runExplorer(issues, [{ field: dimKey(TEAM), op: "in", values: ["c0000001"] }], [], meta).map((i) => i.number).sort()).toEqual([100, 101]);
    expect(missingFields(store.projectFieldMap(), store.listFields())).toEqual([]);
  });

  it("an edit validates against the renamed fields and Close finds the done option", async () => {
    const store = await storeOf(fixtureSnapshot(NOW), suggestMapping(fixtureSnapshot(NOW).fields, {}));
    await importFull(renamed(), store);

    // W2: the Done Status for close is chosen in Settings; until then closing
    // is refused with the reason (and the setting validates against the mapping).
    expect(await doneStatusOption(store)).toMatchObject({ ok: false, reason: expect.stringContaining("Choose a Done Status") });
    await saveCloseDoneStatus("not-an-option");
    expect(await doneStatusOption(store)).toMatchObject({ ok: false, reason: expect.stringContaining("no longer a Status option") });
    await saveCloseDoneStatus("a0000006");
    expect(await doneStatusOption(store)).toEqual({ ok: true, id: "a0000006" });
    const edit = (field: "status" | "release", next: string) =>
      submitEdit({ viewer: "alice", token: "t", store, issueNodeId: "I_epic", body: { field, next }, deps: () => ({}) as ProcessDeps });
    expect((await edit("release", "e0000022")).status).not.toBe(400);
    expect((await edit("status", "a0000002")).status).not.toBe(400);
    expect((await edit("release", "nope")).status).toBe(400);
  });

  it("without a stored mapping the suggestion runs, and a stored one wins over names", () => {
    const f = renamed().fields;
    const stored: FieldMapping = { ...suggestMapping(fixtureSnapshot(NOW).fields, {}), dimensions: [] };
    expect(effectiveMapping(stored, f, {}).dimensions).toEqual([]);
    expect(effectiveMapping(null, f, {}).dimensions.map((d) => d.name)).toEqual(["Squad"]);
  });
});

describe("a deleted field shows Missing field — remap", () => {
  it("is reported, keeps its last name, and its values are not shown as blank", async () => {
    const original = fixtureSnapshot(NOW);
    const store = await storeOf(original, suggestMapping(original.fields, {}));
    // GitHub's full field list without the Team field and the Release field.
    await importFull({ ...original, fields: original.fields.filter((f) => f.id !== TEAM && f.id !== RELEASE) }, store);

    expect(store.missingFields().map((m) => [m.role, m.name])).toEqual([
      ["sprint", "Release"],
      ["dimension", "Team"],
    ]);
    const { meta } = client(store);
    expect(meta.mapping.missing.map((m) => m.name)).toEqual(["Release", "Team"]);
    expect(meta.mapping.sprint).toEqual({ id: RELEASE, name: "Release", missing: true });
    expect(meta.dimensions).toEqual([expect.objectContaining({ id: TEAM, name: "Team", missing: true })]);
    // Sprint features are off, and a deleted dimension is no longer offered.
    expect(sprintOn(meta)).toBe(false);
    expect(filterFields(meta).map((f) => f.key)).not.toContain(dimKey(TEAM));
  });

  it("comes back when GitHub lists the field again", async () => {
    const original = fixtureSnapshot(NOW);
    const store = await storeOf(original, suggestMapping(original.fields, {}));
    await importFull({ ...original, fields: original.fields.filter((f) => f.id !== TEAM) }, store);
    expect(store.missingFields()).toHaveLength(1);
    await importFull(original, store);
    expect(store.missingFields()).toEqual([]);
  });

  it("a partial snapshot (no field list) marks nothing missing", async () => {
    const original = fixtureSnapshot(NOW);
    const store = await storeOf(original, suggestMapping(original.fields, {}));
    await importFull({ ...original, fields: [] }, store);
    expect(store.missingFields()).toEqual([]);
  });
});

describe("applyFieldValues by field ID", () => {
  it("applies a value whose field was renamed, and keeps every single-select by field ID", () => {
    const map = suggestFieldMap([{ id: "F_R", name: "Sprint", dataType: "ITERATION" }, { id: "F_S", name: "Status", dataType: "SINGLE_SELECT" }], {});
    const row = emptyItem();
    applyFieldValues(
      row,
      [
        { iterationId: "it_1", field: { id: "F_R", name: "Cadence" } },
        { optionId: "o_1", field: { id: "F_S", name: "Phase" } },
        { optionId: "o_2", field: { id: "F_X", name: "Squad" } },
      ],
      map,
    );
    expect(row).toMatchObject({ releaseIter: "it_1", statusOpt: "o_1", dims: { F_S: "o_1", F_X: "o_2" } });
  });

  it("ignores another iteration field", () => {
    const map = suggestFieldMap([{ id: "F_R", name: "Release", dataType: "ITERATION" }], {});
    const row = emptyItem();
    applyFieldValues(row, [{ iterationId: "other", field: { id: "F_OTHER", name: "Release" } }], map);
    expect(row.releaseIter).toBeNull();
  });
});
