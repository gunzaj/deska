import { describe, expect, it } from "vitest";
import { buildClientData } from "@/lib/client/build";
import { runExplorer } from "@/lib/client/explorer";
import { hydrate } from "@/lib/client/hydrate";
import { carryOver, githubSearch, githubSearchUrl, hasEnded, releaseLoad } from "@/lib/client/planning";
import { demoSnapshot } from "@/lib/demo/generate";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";

const NOW = new Date("2026-10-12T10:00:00Z");

async function demo() {
  const store = new MemoryStore();
  await importFull(demoSnapshot(NOW), store);
  return hydrate(buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: NOW }));
}

describe("release planning (F1)", () => {
  it("counts match the explorer filtered the same way: per Release, per Team, per assignee", async () => {
    const data = await demo();
    const { meta, issues } = data;
    const release = meta.releases.find((r) => r.id === meta.currentReleaseId)!;
    const load = releaseLoad(issues, release, meta);
    const inRelease = runExplorer(issues, [{ field: "release", op: "in", values: [release.id] }], [], meta);
    expect(load.total).toBe(inRelease.length);
    expect(load.open).toBe(inRelease.filter((i) => i.state === "open").length);
    expect(load.closed).toBe(inRelease.filter((i) => i.state === "closed").length);
    expect(load.total).toBeGreaterThan(0);
    for (const row of load.byTeam.filter((r) => r.key !== "__none")) {
      const rows = runExplorer(issues, [{ field: "release", op: "in", values: [release.id] }, { field: "team", op: "in", values: [row.key] }], [], meta);
      expect([row.open, row.closed]).toEqual([rows.filter((i) => i.state === "open").length, rows.filter((i) => i.state === "closed").length]);
    }
    for (const row of load.byAssignee) {
      const rows = runExplorer(issues, [{ field: "release", op: "in", values: [release.id] }, { field: "assignee", op: "in", values: [row.label] }], [], meta);
      expect([row.open, row.closed]).toEqual([rows.filter((i) => i.state === "open").length, rows.filter((i) => i.state === "closed").length]);
    }
  });

  it("carry-over = open issues in a Release whose last day is before today", async () => {
    const data = await demo();
    const { meta } = data;
    // Two open issues left behind in the previous Release (the demo's past Releases are all closed out).
    const open = data.issues.filter((i) => i.state === "open" && i.releaseId === meta.currentReleaseId).slice(0, 2);
    expect(open).toHaveLength(2);
    const issues = data.issues.map((i) => (open.includes(i) ? { ...i, releaseId: meta.previousReleaseId } : i));
    const left = carryOver(issues, meta);
    const ended = new Set(meta.releases.filter((r) => r.endDate <= meta.today).map((r) => r.id));
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((i) => i.state === "open" && i.releaseId && ended.has(i.releaseId))).toBe(true);
    const expected = issues.filter((i) => i.state === "open" && i.releaseId && ended.has(i.releaseId));
    expect(left.map((i) => i.number).sort()).toEqual(expected.map((i) => i.number).sort());
    // The current Release is never carry-over.
    expect(left.some((i) => i.releaseId === meta.currentReleaseId)).toBe(false);
  });

  it("a Release ends on its exclusive end date", () => {
    expect(hasEnded({ endDate: "2026-10-12" }, "2026-10-12")).toBe(true);
    expect(hasEnded({ endDate: "2026-10-13" }, "2026-10-12")).toBe(false);
  });

  it("builds a GitHub search for the leftovers", () => {
    expect(githubSearch("acme/app", [3, 9])).toBe("repo:acme/app is:issue is:open (#3 OR #9)");
    expect(githubSearchUrl("acme/app", [3])).toBe(`https://github.com/acme/app/issues?q=${encodeURIComponent("repo:acme/app is:issue is:open (#3)")}`);
  });
});
