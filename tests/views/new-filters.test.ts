// D11 (§4.2): Author, In project, Closed reason, Sub-issue progress. Engine, schema, URL state, saved views and Copy/Import.
import { describe, expect, it } from "vitest";
import { buildClientData } from "@/lib/client/build";
import { describeFilter, filterValues, issueValueIds, newFilter, opsFor, runExplorer, setFilterValues } from "@/lib/client/explorer";
import { hydrate } from "@/lib/client/hydrate";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { runView } from "@/lib/views/engine";
import { buildViewRows, type ViewRow } from "@/lib/views/rows";
import { decodeView, encodeView } from "@/lib/views/share";
import { decodeViewState, encodeViewState } from "@/lib/views/url";
import { viewSchema, type Filter, type View } from "@/lib/views/view";
import { fixtureSnapshot } from "../fixtures/github";

const NOW = new Date("2026-10-12T10:00:00Z");
const ctx = (store: MemoryStore) => ({ viewerLogin: "alice", store, todayIso: "2026-10-12T00:00:00Z" });

async function setup() {
  const store = new MemoryStore();
  await importFull(fixtureSnapshot(NOW), store);
  const base = buildViewRows(store)[0]!;
  const row = (n: number, over: Partial<ViewRow>): ViewRow => ({ ...base, nodeId: `I_${n}`, number: n, state: "open", stateReason: null, closedAt: null, ...over });
  return { store, base, row };
}
const run = (store: MemoryStore, filters: Filter[], rows: ViewRow[]) => runView({ id: "", name: "", layout: "list", filters, sort: [] }, ctx(store), rows).map((r) => r.number);

describe("Author filter", () => {
  it("matches logins case-insensitively and resolves me", async () => {
    const { store, row } = await setup();
    const rows = [row(1, { authorLogin: "Alice" }), row(2, { authorLogin: "bob" }), row(3, { authorLogin: "carol" })];
    expect(run(store, [{ field: "author", op: "in", values: ["alice", "BOB"] }], rows)).toEqual([1, 2]);
    expect(run(store, [{ field: "author", op: "in", values: ["me"] }], rows)).toEqual([1]);
    expect(run(store, [{ field: "author", op: "not_in", values: ["bob"] }], rows)).toEqual([1, 3]);
  });
});

describe("In project filter", () => {
  it("separates issues with a project item from those without, even when the item has no values", async () => {
    const { store, row } = await setup();
    const rows = [row(1, { inProject: true }), row(2, { inProject: false })];
    expect(run(store, [{ field: "inProject", op: "in", values: ["yes"] }], rows)).toEqual([1]);
    expect(run(store, [{ field: "inProject", op: "in", values: ["no"] }], rows)).toEqual([2]);
    expect(run(store, [{ field: "inProject", op: "in", values: ["yes", "no"] }], rows)).toEqual([1, 2]);
  });

  it("is read from the project item the sync stored", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(NOW), store);
    const data = hydrate(buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: NOW }));
    const inProject = runExplorer(data.issues, [{ field: "inProject", op: "in", values: ["yes"] }], [], data.meta);
    const outside = runExplorer(data.issues, [{ field: "inProject", op: "in", values: ["no"] }], [], data.meta);
    expect(inProject.length + outside.length).toBe(data.issues.length);
    expect(inProject.every((i) => store.itemForIssue(i.nodeId) != null)).toBe(true);
    expect(outside.every((i) => store.itemForIssue(i.nodeId) == null)).toBe(true);
  });
});

describe("Closed reason filter", () => {
  it("separates completed from not planned (duplicates count as not planned); open issues have no reason", async () => {
    const { store, row } = await setup();
    const rows = [
      row(1, { state: "closed", stateReason: "completed" }),
      row(2, { state: "closed", stateReason: "not_planned" }),
      row(3, { state: "closed", stateReason: "duplicate" }),
      row(4, { state: "closed", stateReason: null }),
      row(5, { state: "open" }),
    ];
    expect(run(store, [{ field: "closedReason", op: "in", values: ["completed"] }], rows)).toEqual([1, 4]);
    expect(run(store, [{ field: "closedReason", op: "in", values: ["not_planned"] }], rows)).toEqual([2, 3]);
    expect(run(store, [{ field: "closedReason", op: "not_in", values: ["not_planned"] }], rows)).toEqual([1, 4, 5]);
  });
});

describe("Sub-issue progress filter", () => {
  it("buckets GitHub's counts; a parent whose counts aren't read yet is in no bucket", async () => {
    const { store, row } = await setup();
    const rows = [
      row(1, { subTotal: null, subCompleted: null, hasSubIssues: false }),
      row(2, { subTotal: 0, subCompleted: 0, hasSubIssues: false }),
      row(3, { subTotal: 4, subCompleted: 0, hasSubIssues: true }),
      row(4, { subTotal: 4, subCompleted: 2, hasSubIssues: true }),
      row(5, { subTotal: 4, subCompleted: 4, hasSubIssues: true }),
      row(6, { subTotal: null, subCompleted: null, hasSubIssues: true }),
    ];
    const by = (v: string) => run(store, [{ field: "subProgress", op: "in", values: [v as "none"] }], rows);
    expect(by("none")).toEqual([1, 2]);
    expect(by("not_started")).toEqual([3]);
    expect(by("in_progress")).toEqual([4]);
    expect(by("done")).toEqual([5]);
    expect(run(store, [{ field: "subProgress", op: "in", values: ["not_started", "in_progress"] }], rows)).toEqual([3, 4]);
  });
});

describe("round trips", () => {
  const filters: Filter[] = [
    { field: "author", op: "in", values: ["bob", "me"] },
    { field: "inProject", op: "in", values: ["no"] },
    { field: "closedReason", op: "not_in", values: ["not_planned"] },
    { field: "subProgress", op: "in", values: ["in_progress", "done"] },
  ];
  const view: View = { id: "v-1", name: "New filters", layout: "list", filters, sort: [{ field: "updated", dir: "desc" }] };

  it("pass the strict view schema and keep their values", () => {
    expect(viewSchema.parse(view).filters).toEqual(filters);
  });

  it("refuse values outside the fixed lists", () => {
    for (const bad of [
      { field: "inProject", op: "in", values: ["maybe"] },
      { field: "closedReason", op: "in", values: ["reopened"] },
      { field: "subProgress", op: "in", values: ["half"] },
      { field: "inProject", op: "not_in", values: ["yes"] },
    ])
      expect(viewSchema.safeParse({ ...view, filters: [bad] }).success).toBe(false);
  });

  it("survive URL state", () => {
    const state = { filters, sort: view.sort, groupBy: undefined };
    expect(decodeViewState(encodeViewState(state), { filters: [], sort: [] })).toEqual(state);
  });

  it("survive Copy view → Import view", () => {
    const r = decodeView(encodeView(view));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.view.filters).toEqual(filters);
  });
});

describe("filter editing helpers", () => {
  it("offer the fixed values and drop foreign ones", () => {
    expect(newFilter("inProject", "yes")).toEqual({ field: "inProject", op: "in", values: ["yes"] });
    expect(newFilter("closedReason", "bogus")).toEqual({ field: "closedReason", op: "in", values: [] });
    expect(setFilterValues([newFilter("subProgress", "done")], 0, ["done", "bogus", "none"])).toEqual([{ field: "subProgress", op: "in", values: ["done", "none"] }]);
    expect(opsFor("author").map((o) => o.op)).toEqual(["in", "not_in"]);
    expect(opsFor("closedReason").map((o) => o.op)).toEqual(["in", "not_in"]);
    expect(opsFor("inProject").map((o) => o.op)).toEqual(["in"]);
  });

  it("list authors by issue count, with me first, and say each filter in words", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(NOW), store);
    const data = hydrate(buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: NOW }));
    const authors = filterValues("author", data.meta, data.issues);
    expect(authors[0]).toMatchObject({ id: "me", kind: "me" });
    expect(new Set(authors.slice(1).map((a) => a.id))).toEqual(new Set(data.issues.map((i) => i.authorLogin)));
    expect(issueValueIds(data.issues[0]!, "author")).toEqual([data.issues[0]!.authorLogin]);
    expect(describeFilter({ field: "closedReason", op: "in", values: ["not_planned"] }, data.meta, data.issues)).toBe("Closed reason is Not planned");
    expect(describeFilter({ field: "inProject", op: "in", values: ["no"] }, data.meta, data.issues)).toBe("In project is No");
    expect(describeFilter({ field: "author", op: "not_in", values: ["bob"] }, data.meta, data.issues)).toBe("Author excludes bob");
    expect(describeFilter({ field: "text", op: "contains", value: "crash" }, data.meta, data.issues)).toBe('search "crash"');
  });
});

describe("saved views", () => {
  it("store and return the new filters unchanged", async () => {
    const { __resetViews, submitView, viewsFor } = await import("@/lib/views/runtime");
    __resetViews();
    const filters: Filter[] = [
      { field: "author", op: "in", values: ["bob"] },
      { field: "inProject", op: "in", values: ["no"] },
      { field: "closedReason", op: "in", values: ["completed"] },
      { field: "subProgress", op: "in", values: ["done"] },
    ];
    const saved = await submitView({ id: "", name: "D11", layout: "table", filters, sort: [] });
    expect((await viewsFor()).find((v) => v.id === saved.id)!.filters).toEqual(filters);
  });
});
