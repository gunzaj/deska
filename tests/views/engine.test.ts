import { describe, expect, it } from "vitest";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { buildViewRows, resolveRelease } from "@/lib/views/rows";
import { groupRowEntries, runView } from "@/lib/views/engine";
import { trySeedViews } from "@/lib/views/seeds";
import { viewSchema, type View } from "@/lib/views/view";
import { fixtureSnapshot } from "../fixtures/github";

const TODAY = "2026-10-09T00:00:00Z"; // inside Sprint 23 (Oct 7 +28d)

async function setup() {
  const store = new MemoryStore();
  await await importFull(fixtureSnapshot(new Date(TODAY)), store);
  return { store, rows: buildViewRows(store) };
}

describe("saved views engine (M5)", () => {
  it("validates view JSON", async () => {
    const seeds = trySeedViews((await setup()).store);
    for (const s of seeds) expect(viewSchema.parse(s)).toBeTruthy();
  });

  it("covers every filter op", async () => {
    const { store, rows } = await setup();
    const ctx = { viewerLogin: "alice", store, todayIso: TODAY };
    const v = (filters: View["filters"]): View => ({
      id: "t", name: "t",
      layout: "list", filters, sort: [],
    });
    // assignee in (me) / not_in / empty
    expect(runView(v([{ field: "assignee", op: "in", values: ["me"] }]), ctx, rows).map((r) => r.number)).toEqual([100]);
    expect(runView(v([{ field: "assignee", op: "empty" }]), ctx, rows).map((r) => r.number)).toEqual([101]);
    expect(runView(v([{ field: "assignee", op: "not_in", values: ["alice"] }]), ctx, rows).map((r) => r.number).sort()).toEqual([101, 102]);
    // status in / empty
    expect(runView(v([{ field: "status", op: "in", values: ["a0000001"] }]), ctx, rows).map((r) => r.number)).toEqual([100]);
    expect(runView(v([{ field: "status", op: "empty" }]), ctx, rows).map((r) => r.number)).toEqual([102]);
    // release current / empty
    expect(runView(v([{ field: "release", op: "in", values: ["current"] }]), ctx, rows).map((r) => r.number)).toEqual([100]);
    expect(runView(v([{ field: "release", op: "empty" }]), ctx, rows).map((r) => r.number).sort()).toEqual([101, 102]);
    // parent in / empty / has_sub_issues
    expect(runView(v([{ field: "parent", op: "in", values: ["I_epic"] }]), ctx, rows).map((r) => r.number)).toEqual([101]);
    expect(runView(v([{ field: "parent", op: "empty" }]), ctx, rows).map((r) => r.number).sort()).toEqual([100, 102]);
    expect(runView(v([{ field: "parent", op: "has_sub_issues" }]), ctx, rows).map((r) => r.number)).toEqual([100]);
    // state in
    expect(runView(v([{ field: "state", op: "in", values: ["closed"] }]), ctx, rows)).toEqual([]);
    // text contains (title, #number)
    expect(runView(v([{ field: "text", op: "contains", value: "#101" }]), ctx, rows).map((r) => r.number)).toEqual([101]);
    expect(runView(v([{ field: "text", op: "contains", value: "overhaul" }]), ctx, rows).map((r) => r.number)).toEqual([100]);
    // label / type / milestone
    expect(runView(v([{ field: "label", op: "in", values: ["LA_1"] }]), ctx, rows).map((r) => r.number)).toEqual([100]);
    expect(runView(v([{ field: "type", op: "in", values: ["IT_acme_bug"] }]), ctx, rows).map((r) => r.number)).toEqual([102]);
    expect(runView(v([{ field: "milestone", op: "in", values: ["M_1"] }]), ctx, rows).map((r) => r.number)).toEqual([100]);
  });

  it("resolves me + current/next/previous release", async () => {
    const { store } = await setup();
    expect(resolveRelease(store, "current", TODAY)).toBe("e0000023");
    expect(resolveRelease(store, "previous", TODAY)).toBe("e0000022");
    expect(resolveRelease(store, "next", TODAY)).toBeNull(); // no later fixture iteration
  });

  it("sorts multi-key with Priority rank", async () => {
    const { store, rows } = await setup();
    const ctx = { viewerLogin: "alice", store, todayIso: TODAY };
    const seeds = trySeedViews(store);
    const mine = runView(seeds[0]!, ctx, rows);
    expect(mine.map((r) => r.number)).toEqual([100]); // only alice's open ticket
    const byPriority = runView(
      { id: "t", name: "t", layout: "list", filters: [], sort: [{ field: "priority", dir: "desc" }, { field: "updated", dir: "desc" }] },
      ctx, rows,
    );
    expect(byPriority.map((r) => r.number)).toEqual([100, 101, 102]); // HIGH, MED, empty
  });

  it("groups by a dimension, Type, Release and parent", async () => {
    const { rows } = await setup();
    const by = (f: string) => new Map(groupRowEntries(rows, f).map((g) => [g.key, g.rows]));
    expect(by("dim:PVTSSF_acme_team").get("c0000001")?.length).toBe(2);
    expect(by("dim:PVTSSF_acme_team").get("empty")?.length).toBe(1);
    expect(by("type").size).toBe(3);
    expect(by("release").get("e0000023")?.length).toBe(1);
    expect(by("parent").get("I_epic")?.length).toBe(1);
    // A dimension the project doesn't map: every row has no value.
    expect(by("dim:PVTSSF_acme_platform").get("empty")?.length).toBe(3);
  });

  it("group headings carry display names, not raw GitHub IDs", async () => {
    const { rows } = await setup();
    const team = groupRowEntries(rows, "dim:PVTSSF_acme_team").find((g) => g.key === "c0000001");
    expect(team?.label).toBe("Core 🧱");
    const release = groupRowEntries(rows, "release").find((g) => g.key === "e0000023");
    expect(release?.label).toBe("Sprint 23");
    // Ungrouped values still need a human label.
    expect(groupRowEntries(rows, "dim:PVTSSF_acme_team").find((g) => g.key === "empty")?.label).toBe(
      "No value",
    );
    const parent = groupRowEntries(rows, "parent").find((g) => g.key === "I_epic");
    expect(parent?.label).toContain("#100");
  });

  it("exposes display names for table layout", async () => {
    const { rows } = await setup();
    const epic = rows.find((r) => r.number === 100)!;
    expect(epic.statusName).toBe("📋 To do");
    expect(epic.priorityName).toBe("High");
    expect(epic.dims.PVTSSF_acme_team?.name).toBe("Core 🧱");
    expect(epic.releaseName).toBe("Sprint 23");
    const bug = rows.find((r) => r.number === 102)!;
    expect(bug.statusName).toBeNull();
  });

  it("seed views run (release table by the first dimension, epics)", async () => {
    const { store, rows } = await setup();
    const ctx = { viewerLogin: "alice", store, todayIso: TODAY };
    const seeds = trySeedViews(store);
    expect(seeds.map((v) => v.id)).toEqual(["seed-my-tickets", "seed-untriaged", "seed-release-teams", "seed-epics"]);
    expect(seeds[2]).toMatchObject({ name: "Current Release by Team", groupBy: "dim:PVTSSF_acme_team" });
    expect(runView(seeds[2]!, ctx, rows).map((r) => r.number)).toEqual([100]);
    expect(runView(seeds[3]!, ctx, rows).map((r) => r.number)).toEqual([100]);
  });
});

describe("sorting regression (fields that used to be ignored)", () => {
  // Fixture ground truth:
  //   I_epic  100  Status=To do(0)  Priority=HIGH(2)   Team=Core(0)  Release=Sprint 23(rank 1)  type=Feature  label=UI         milestone=Sprint 23
  //   I_sub   101  Status=In prog(1) Priority=MED(1)   Team=Core(0)  Release=-              type=Task    label=dashboard  milestone=-
  //   I_bug   102  Status=-         Priority=-         Team=-                Release=-              type=Bug     label=-         milestone=-
  async function sortedBy(field: string, dir: "asc" | "desc" = "asc") {
    const { store, rows } = await setup();
    const ctx = { viewerLogin: "alice", store, todayIso: TODAY };
    return runView(
      { id: "t", name: "t", layout: "list",
        filters: [], sort: [{ field, dir }] },
      ctx,
      rows,
    ).map((r) => r.nodeId);
  }

  it("sorts by Status in the project's option order, not by option ID", async () => {
    // Regression: status sorted by optionId, and the fixture IDs (a0000001 vs
    // a0000002) point the opposite way to the intended To do -> In progress order.
    expect(await sortedBy("status")).toEqual(["I_epic", "I_sub", "I_bug"]);
    expect(await sortedBy("status", "desc")).toEqual(["I_sub", "I_epic", "I_bug"]);
  });

  it("sorts by Team and Priority using option position", async () => {
    expect(await sortedBy("team")).toEqual(["I_epic", "I_sub", "I_bug"]);
    expect(await sortedBy("priority")).toEqual(["I_sub", "I_epic", "I_bug"]); // MED < HIGH
  });

  it("sorts by fields that previously returned no key at all", async () => {
    // Regression: type/label/milestone/release all fell through to `null`, so
    // the comparator returned 0 and the rows kept their incidental order.
    expect(await sortedBy("type")).toEqual(["I_bug", "I_epic", "I_sub"]); // Bug < Feature < Task
    expect(await sortedBy("label")).toEqual(["I_sub", "I_epic", "I_bug"]); // dashboard < UI
    expect(await sortedBy("milestone")).toEqual(["I_epic", "I_sub", "I_bug"]); // Sprint 23 first
    expect(await sortedBy("release")).toEqual(["I_epic", "I_sub", "I_bug"]); // Sprint 23 first
    expect(await sortedBy("assignee")).toEqual(["I_epic", "I_bug", "I_sub"]); // alice, bob
  });

  it("keeps empty values last in both directions", async () => {
    for (const dir of ["asc", "desc"] as const) {
      const { store, rows } = await setup();
      const ctx = { viewerLogin: "alice", store, todayIso: TODAY };
      const sorted = runView(
        { id: "t", name: "t", layout: "list",
          filters: [], sort: [{ field: "priority", dir }] },
        ctx,
        rows,
      );
      expect(sorted.at(-1)?.nodeId).toBe("I_bug"); // the untriaged one
    }
  });
});

describe("parent progress in views (§4.4)", () => {
  it("rows carry GitHub's counts, and filtering to one child leaves the parent's counts alone", async () => {
    const { store, rows } = await setup();
    const epic = rows.find((r) => r.number === 100)!;
    expect([epic.subTotal, epic.subCompleted, epic.hasSubIssues]).toEqual([1, 0, true]);
    const ctx = { viewerLogin: "alice", store, todayIso: TODAY };
    const only = runView({ id: "t", name: "t", layout: "list", filters: [{ field: "parent", op: "in", values: ["I_epic"] }], sort: [] }, ctx, rows);
    expect(only.map((r) => r.number)).toEqual([101]);
    // The parent is built from the store, not from the filtered list.
    expect(buildViewRows(store, "I_epic")[0]).toMatchObject({ subTotal: 1, subCompleted: 0 });
  });

  it("sorts by progress with children without counts last", async () => {
    const { store, rows } = await setup();
    const ctx = { viewerLogin: "alice", store, todayIso: TODAY };
    const a = { ...rows[0]!, number: 1, subTotal: 4, subCompleted: 3, hasSubIssues: true };
    const b = { ...rows[0]!, number: 2, subTotal: 4, subCompleted: 1, hasSubIssues: true };
    const c = { ...rows[0]!, number: 3, subTotal: null, subCompleted: null, hasSubIssues: false };
    const out = runView({ id: "t", name: "t", layout: "list", filters: [], sort: [{ field: "progress", dir: "desc" }] }, ctx, [c, b, a]);
    expect(out.map((r) => r.number)).toEqual([1, 2, 3]);
  });
});

describe("a filter with no value picked", () => {
  it("is no constraint: the chip reads \"is any\", so it keeps every row", async () => {
    const { store, rows } = await setup();
    const ctx = { viewerLogin: "alice", store, todayIso: TODAY };
    const run = (filters: View["filters"]) => runView({ id: "t", name: "t", layout: "list", filters, sort: [] }, ctx, rows).length;
    expect(rows.length).toBeGreaterThan(0);
    for (const field of ["status", "priority", "label", "assignee", "author", "type", "milestone", "release"] as const) {
      expect(run([{ field, op: "in", values: [] } as View["filters"][number]]), `${field} in []`).toBe(rows.length);
      expect(run([{ field, op: "not_in", values: [] } as View["filters"][number]]), `${field} not_in []`).toBe(rows.length);
    }
  });

  it("a named sprint that does not exist still matches nothing", async () => {
    const { store, rows } = await setup();
    // A day before every iteration: "current" resolves to no sprint.
    const ctx = { viewerLogin: "alice", store, todayIso: "2020-01-01T00:00:00Z" };
    const view: View = { id: "t", name: "t", layout: "list", filters: [{ field: "release", op: "in", values: ["current"] }], sort: [] };
    expect(runView(view, ctx, rows)).toHaveLength(0);
  });
});
