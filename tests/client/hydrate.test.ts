// v5 3.3/3.4: unchanged rows are reused, and a reused row is never stale.
import { describe, expect, it } from "vitest";
import { hydrate } from "@/lib/client/hydrate";
import { applyWire } from "@/lib/client/edit";
import { reuseRows, sameRow } from "@/lib/client/reuse";
import type { ClientMeta, WireData, WireIssue } from "@/lib/client/types";

const meta = (over: Partial<ClientMeta> = {}): ClientMeta => ({
  repo: "o/r",
  viewer: "alice",
  writeMode: false,
  demo: true,
  generatedAt: "2026-10-16T00:00:00Z",
  today: "2026-10-16",
  fields: { status: [{ id: "s1", name: "To do", color: "BLUE", position: 0 }, { id: "s2", name: "Done", color: "GREEN", position: 1 }], priority: [] },
  dimensions: [],
  mapping: { status: null, priority: null, sprint: null, missing: [], doneStatusIds: [] },
  releases: [],
  currentReleaseId: null,
  nextReleaseId: null,
  previousReleaseId: null,
  issueTypes: [],
  labels: [],
  milestones: [],
  users: [],
  ...over,
});
const row = (n: number, over: Partial<WireIssue> = {}): WireIssue => ({ id: `I_${n}`, n, t: `Issue ${n}`, o: 1, au: "alice", c: "2026-10-01T00:00:00Z", u: "2026-10-02T00:00:00Z", st: "s1", ...over });
const wire = (issues: WireIssue[], m = meta()): WireData => ({ meta: m, issues });

describe("hydrate row cache", () => {
  it("hands back the same row object for an unchanged wire row", () => {
    const w = wire([row(1), row(2)]);
    const a = hydrate(w);
    const b = hydrate({ meta: meta(), issues: [...w.issues] });
    expect(b.issues[0]).toBe(a.issues[0]);
    expect(b.issues[1]).toBe(a.issues[1]);
  });

  it("rebuilds only the row an edit touched", () => {
    const w = wire([row(1), row(2), row(3)]);
    const a = hydrate(w);
    const b = hydrate({ meta: w.meta, issues: w.issues.map((x) => (x.id === "I_2" ? applyWire(x, { st: "s2" }) : x)) });
    expect(b.issues[0]).toBe(a.issues[0]);
    expect(b.issues[2]).toBe(a.issues[2]);
    expect(b.issues[1]).not.toBe(a.issues[1]);
    expect(b.issues[1]!.statusName).toBe("Done");
  });

  it("never reuses a row whose metadata changed (a renamed option)", () => {
    const w = wire([row(1)]);
    expect(hydrate(w).issues[0]!.statusName).toBe("To do");
    const renamed = meta({ fields: { ...meta().fields, status: [{ id: "s1", name: "Backlog", color: "BLUE", position: 0 }] } });
    expect(hydrate({ meta: renamed, issues: w.issues }).issues[0]!.statusName).toBe("Backlog");
  });

  it("never reuses a child row whose parent title changed, and takes GitHub's counts for the parent", () => {
    const child = row(2, { pa: "I_1" });
    const first = hydrate(wire([row(1, { sc: [1, 0] }), child]));
    expect(first.issues[1]!.parentTitle).toBe("Issue 1");
    expect(first.issues[0]).toMatchObject({ subTotal: 1, subCompleted: 0, hasSubIssues: true });
    // The same child object, a retitled parent and new counts from GitHub.
    const second = hydrate(wire([row(1, { t: "Renamed parent", sc: [2, 1] }), child, row(3, { pa: "I_1", o: 0 })]));
    expect(second.issues[1]!.parentTitle).toBe("Renamed parent");
    expect(second.issues[0]).toMatchObject({ subTotal: 2, subCompleted: 1 });
  });

  it("does not count children in the cache: no summary means not loaded, never a number (§4.4)", () => {
    const h = hydrate(wire([row(1), row(2, { pa: "I_1" }), row(3, { pa: "I_1", o: 0 })]));
    expect(h.issues[0]).toMatchObject({ subTotal: null, subCompleted: null, hasSubIssues: true });
    expect(h.issues[1]).toMatchObject({ subTotal: null, hasSubIssues: false });
  });

  it("a parent's progress does not depend on which rows are in the list (filters never change it)", () => {
    const parent = row(1, { sc: [4, 2] });
    const all = hydrate(wire([parent, row(2, { pa: "I_1" }), row(3, { pa: "I_1" }), row(4, { pa: "I_1", o: 0 }), row(5, { pa: "I_1", o: 0 })]));
    const onlyOneChild = hydrate(wire([parent, row(2, { pa: "I_1" })]));
    expect(all.issues[0]).toMatchObject({ subTotal: 4, subCompleted: 2 });
    expect(onlyOneChild.issues[0]).toMatchObject({ subTotal: 4, subCompleted: 2 });
  });
});

describe("reuseRows", () => {
  it("keeps the previous object for each unchanged row, and takes the new one for a changed row", () => {
    const prev = wire([row(1, { lb: ["a", "b"] }), row(2)]);
    const next = wire([row(1, { lb: ["a", "b"] }), row(2, { t: "Changed" })]);
    const out = reuseRows(prev, next);
    expect(out.issues[0]).toBe(prev.issues[0]);
    expect(out.issues[1]).toBe(next.issues[1]);
  });

  it("returns the same issues array when nothing changed", () => {
    const prev = wire([row(1), row(2)]);
    expect(reuseRows(prev, wire([row(1), row(2)])).issues).toBe(prev.issues);
    expect(reuseRows(prev, wire([row(2), row(1)])).issues).not.toBe(prev.issues); // reordered
    expect(reuseRows(prev, wire([row(1)])).issues).toHaveLength(1);
  });

  it("compares labels and assignees by content", () => {
    expect(sameRow(row(1, { lb: ["a"] }), row(1, { lb: ["a"] }))).toBe(true);
    expect(sameRow(row(1, { lb: ["a"] }), row(1, { lb: ["b"] }))).toBe(false);
    expect(sameRow(row(1, { as: ["x"] }), row(1))).toBe(false);
  });
});
