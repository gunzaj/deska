import { describe, expect, it } from "vitest";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { buildViewRows, resolveRelease } from "@/lib/views/rows";
import { groupRowEntries, runView, visibleViews } from "@/lib/views/engine";
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
    const seeds = trySeedViews((await setup()).store, "alice");
    for (const s of seeds) expect(viewSchema.parse(s)).toBeTruthy();
  });

  it("covers every filter op", async () => {
    const { store, rows } = await setup();
    const ctx = { viewerLogin: "alice", store, todayIso: TODAY };
    const v = (filters: View["filters"]): View => ({
      id: "t", name: "t", ownerId: "alice", visibility: "personal",
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
    const seeds = trySeedViews(store, "alice");
    const mine = runView(seeds[0]!, ctx, rows);
    expect(mine.map((r) => r.number)).toEqual([100]); // only alice's open ticket
    const byPriority = runView(
      { id: "t", name: "t", ownerId: "x", visibility: "personal", layout: "list", filters: [], sort: [{ field: "priority", dir: "desc" }, { field: "updated", dir: "desc" }] },
      ctx, rows,
    );
    expect(byPriority.map((r) => r.number)).toEqual([100, 101, 102]); // HIGH, MED, empty
  });

  it("groups by Team, Platform, Type, Release and parent", async () => {
    const { rows } = await setup();
    const by = (f: string) => new Map(groupRowEntries(rows, f).map((g) => [g.key, g.rows]));
    expect(by("team").get("c0000001")?.length).toBe(2);
    expect(by("type").size).toBe(3);
    expect(by("release").get("e0000023")?.length).toBe(1);
    expect(by("parent").get("I_epic")?.length).toBe(1);
    expect(by("platform").get("empty")?.length).toBe(3);
  });

  it("group headings carry display names, not raw GitHub IDs", async () => {
    const { rows } = await setup();
    const team = groupRowEntries(rows, "team").find((g) => g.key === "c0000001");
    expect(team?.label).toBe("Core 🧱");
    const release = groupRowEntries(rows, "release").find((g) => g.key === "e0000023");
    expect(release?.label).toBe("Sprint 23");
    // Ungrouped values still need a human label.
    expect(groupRowEntries(rows, "platform").find((g) => g.key === "empty")?.label).toBe(
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
    expect(epic.teamName).toBe("Core 🧱");
    expect(epic.releaseName).toBe("Sprint 23");
    const bug = rows.find((r) => r.number === 102)!;
    expect(bug.statusName).toBeNull();
  });

  it("shares shared views, hides others' personal views", async () => {
    const views: View[] = [
      { id: "a", name: "a", ownerId: "alice", visibility: "personal", layout: "list", filters: [], sort: [] },
      { id: "b", name: "b", ownerId: "bob", visibility: "personal", layout: "list", filters: [], sort: [] },
      { id: "c", name: "c", ownerId: "bob", visibility: "shared", layout: "list", filters: [], sort: [] },
    ];
    expect(visibleViews(views, "alice").map((v) => v.id).sort()).toEqual(["a", "c"]);
  });

  it("seed views run (core board, release table, epics)", async () => {
    const { store, rows } = await setup();
    const ctx = { viewerLogin: "alice", store, todayIso: TODAY };
    const seeds = trySeedViews(store, "alice");
    expect(runView(seeds[1]!, ctx, rows).map((r) => r.number)).toEqual([100]);
    expect(runView(seeds[3]!, ctx, rows).map((r) => r.number)).toEqual([100]);
    expect(runView(seeds[4]!, ctx, rows).map((r) => r.number)).toEqual([100]);
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
      { id: "t", name: "t", ownerId: "x", visibility: "personal", layout: "list",
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
        { id: "t", name: "t", ownerId: "x", visibility: "personal", layout: "list",
          filters: [], sort: [{ field: "priority", dir }] },
        ctx,
        rows,
      );
      expect(sorted.at(-1)?.nodeId).toBe("I_bug"); // the untriaged one
    }
  });
});
