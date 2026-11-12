import { describe, expect, it } from "vitest";
import { buildClientData } from "@/lib/client/build";
import { groupIssues, groupOptions, runExplorer } from "@/lib/client/explorer";
import { hydrate } from "@/lib/client/hydrate";
import { filterSummary, neighbour, releaseTeamFilters, sprintBucket, sprintStats, sprintTiming } from "@/lib/client/sprint";
import { scopeFilter } from "@/lib/client/team-scope";
import type { ClientDimension, ClientIssue } from "@/lib/client/types";
import type { Filter } from "@/lib/views/view";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { fixtureSnapshot } from "../fixtures/github";

const NOW = new Date("2026-10-12T10:00:00Z");

async function client() {
  const store = new MemoryStore();
  await importFull(fixtureSnapshot(NOW), store);
  return hydrate(buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: NOW }));
}

const row = (over: Partial<ClientIssue>): ClientIssue => ({ state: "open", stateReason: null, statusId: null, ...over }) as ClientIssue;

describe("sprint buckets (§4.5)", () => {
  it("open is Remaining; closed as completed is Done; closed as not planned is Not planned", () => {
    expect(sprintBucket(row({}))).toBe("remaining");
    expect(sprintBucket(row({ state: "closed", stateReason: "completed" }))).toBe("done");
    expect(sprintBucket(row({ state: "closed", stateReason: null }))).toBe("done");
    expect(sprintBucket(row({ state: "closed", stateReason: "not_planned" }))).toBe("notPlanned");
    expect(sprintBucket(row({ state: "closed", stateReason: "duplicate" }))).toBe("notPlanned");
  });

  it("an open issue whose Status is marked as done counts as Done; closed ones stay as they are", () => {
    expect(sprintBucket(row({ statusId: "s-qa" }), ["s-qa"])).toBe("done");
    expect(sprintBucket(row({ statusId: "s-todo" }), ["s-qa"])).toBe("remaining");
    expect(sprintBucket(row({ state: "closed", stateReason: "not_planned", statusId: "s-qa" }), ["s-qa"])).toBe("notPlanned");
  });
});

describe("sprint header numbers", () => {
  it("done X / Y and %, with not planned left out of both", async () => {
    const { meta } = await client();
    const issues = [row({}), row({}), row({ state: "closed" }), row({ state: "closed", stateReason: "not_planned" })];
    const s = sprintStats(issues, meta);
    expect([s.remaining, s.done, s.notPlanned, s.counted, s.pct]).toEqual([2, 1, 1, 3, 33]);
  });

  it("Status options marked as done count as done", async () => {
    const { meta } = await client();
    const doneId = meta.fields.status[1]!.id;
    const issues = [row({ statusId: doneId }), row({ statusId: meta.fields.status[0]!.id }), row({ state: "closed" })];
    const withDone = sprintStats(issues, { ...meta, mapping: { ...meta.mapping, doneStatusIds: [doneId] } });
    expect([withDone.done, withDone.remaining, withDone.pct]).toEqual([2, 1, 67]);
    const without = sprintStats(issues, { ...meta, mapping: { ...meta.mapping, doneStatusIds: [] } });
    expect([without.done, without.remaining, without.pct]).toEqual([1, 2, 33]);
  });

  it("has no percentage when nothing is counted", async () => {
    const { meta } = await client();
    expect(sprintStats([], meta).pct).toBeNull();
    expect(sprintStats([row({ state: "closed", stateReason: "not_planned" })], meta).pct).toBeNull();
  });

  it("counts open issues by Status in project order, then those without one", async () => {
    const { meta } = await client();
    const [a, b] = meta.fields.status;
    const s = sprintStats([row({ statusId: b!.id }), row({}), row({ statusId: a!.id }), row({ statusId: b!.id }), row({ state: "closed", statusId: a!.id })], meta);
    expect(s.byStatus).toEqual([
      { id: a!.id, n: 1 },
      { id: b!.id, n: 2 },
      { id: null, n: 1 },
    ]);
  });

  it("the header numbers follow the filtered rows and match the explorer's own count", async () => {
    const data = await client();
    const sprint = data.issues.filter((i) => i.releaseId === data.meta.currentReleaseId);
    const dim = data.meta.dimensions[0]!;
    const opt = dim.options[0]!;
    const rows = runExplorer(sprint, [{ field: dim.key, op: "in", values: [opt.id] }], [], data.meta);
    const filtered = sprintStats(rows, data.meta);
    expect(filtered.counted + filtered.notPlanned).toBe(rows.length);
    expect(rows.length).toBeLessThanOrEqual(sprint.length);
    // Saying so: the label names the value.
    expect(filterSummary([{ field: dim.key, op: "in", values: [opt.id] }], data.meta, data.issues)).toContain(opt.name.trim());
  });
});

describe("release overview team scope", () => {
  const dim: ClientDimension = {
    id: "F_team",
    key: "dim:F_team",
    name: "Team",
    missing: false,
    options: [
      { id: "t1", name: "Core", color: "", position: 0 },
      { id: "t2", name: "Checkout", color: "", position: 1 },
    ],
  };
  const defaultScope = { dimension: dim, optionId: "t1", name: "Core" };
  const scope = { dimension: dim, optionId: "t1", name: "Core" };
  const base: Filter[] = [{ field: "release", op: "in", values: ["e0000023"] }];
  const open: Filter = { field: "state", op: "in", values: ["open"] };
  const otherTeam: Filter = { field: dim.key, op: "in", values: ["t2"] };

  it("follows the default team unless the page filters that dimension itself", () => {
    expect(releaseTeamFilters([], base, defaultScope, scope)).toEqual([scopeFilter(scope)]);
    expect(releaseTeamFilters([open], base, defaultScope, scope)).toEqual([scopeFilter(scope)]);
    expect(releaseTeamFilters([otherTeam], base, defaultScope, scope)).toEqual([otherTeam]);
  });

  it("is off without a default or when the viewer turned it off", () => {
    expect(releaseTeamFilters([], base, null, null)).toEqual([]);
    expect(releaseTeamFilters([open], base, defaultScope, null)).toEqual([]);
    expect(releaseTeamFilters([otherTeam], base, defaultScope, null)).toEqual([otherTeam]);
  });

  it("keeps a page filter that already pins the dimension", () => {
    expect(releaseTeamFilters([], [otherTeam], defaultScope, scope)).toEqual([otherTeam]);
  });
});

describe("current sprint by date", () => {
  const r = { startDate: "2026-10-05", endDate: "2026-10-19" };
  it("start ≤ today < end is current; the exclusive end day is already past", () => {
    expect(sprintTiming(r, "2026-10-05")).toEqual({ phase: "current", daysLeft: 14, startsIn: null });
    expect(sprintTiming(r, "2026-10-18")).toEqual({ phase: "current", daysLeft: 1, startsIn: null });
    expect(sprintTiming(r, "2026-10-19").phase).toBe("past");
    expect(sprintTiming(r, "2026-10-04")).toEqual({ phase: "upcoming", daysLeft: null, startsIn: 1 });
  });

  it("the server resolves the current, previous and next sprint on the same rule", async () => {
    const { meta } = await client();
    const current = meta.releases.find((x) => x.id === meta.currentReleaseId)!;
    expect(sprintTiming(current, meta.today).phase).toBe("current");
    expect(neighbour(meta.releases, current.id, -1)).toBe(meta.previousReleaseId);
    expect(neighbour(meta.releases, current.id, 1)).toBe(meta.nextReleaseId);
  });

  it("the picker has nothing before the first or after the last sprint", () => {
    const list = [{ id: "a" }, { id: "b" }];
    expect(neighbour(list, "a", -1)).toBeNull();
    expect(neighbour(list, "b", 1)).toBeNull();
    expect(neighbour(list, "a", 1)).toBe("b");
    expect(neighbour(list, "zzz", 1)).toBeNull();
  });
});

describe("Remaining / Done grouping", () => {
  it("groups in that order, with Not planned collapsed", async () => {
    const { meta } = await client();
    const groups = groupIssues([row({ state: "closed", stateReason: "not_planned" }), row({ state: "closed" }), row({})], "sprintState", meta);
    expect(groups.map((g) => [g.key, g.label, !!g.collapsed])).toEqual([
      ["remaining", "Remaining", false],
      ["done", "Done", false],
      ["notPlanned", "Not planned", true],
    ]);
  });

  it("is offered as a grouping only when a Sprint field is mapped", async () => {
    const { meta } = await client();
    expect(groupOptions(meta).some((o) => o.key === "sprintState")).toBe(true);
    expect(groupOptions({ ...meta, mapping: { ...meta.mapping, sprint: null } }).some((o) => o.key === "sprintState")).toBe(false);
  });
});
