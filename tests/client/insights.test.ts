import { describe, expect, it } from "vitest";
import { buildClientData } from "@/lib/client/build";
import { runExplorer } from "@/lib/client/explorer";
import { hydrate } from "@/lib/client/hydrate";
import { insightStats, parseScope, parseWaitDays, prsForIssues, scopeFilters, scopeParam, scopedIssues, waitingForReview, waitingSince } from "@/lib/client/insights";
import type { ClientPr } from "@/lib/client/types";
import { demoSnapshot } from "@/lib/demo/generate";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import type { Filter, View } from "@/lib/views/view";

const NOW = new Date("2026-10-12T10:00:00Z");

async function demo() {
  const store = new MemoryStore();
  await importFull(demoSnapshot(), store);
  return hydrate(buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: NOW }));
}

describe("scoped Insights (F4)", () => {
  it("parses and prints the scope from the URL", () => {
    expect(parseScope(null)).toEqual({ kind: "all" });
    expect(parseScope("nonsense")).toEqual({ kind: "all" });
    expect(parseScope("team:abc")).toEqual({ kind: "team", id: "abc" });
    expect(scopeParam(parseScope("release:r:1"))).toBe("release:r:1");
    expect(scopeParam({ kind: "all" })).toBeNull();
  });

  it("scoped counts match the explorer filtered the same way (Team, Release, saved view)", async () => {
    const data = await demo();
    const { meta, issues } = data;
    const triageBase: Filter[] = [{ field: "state", op: "in", values: ["open"] }, { field: "any", filters: [{ field: "priority", op: "empty" }, { field: "team", op: "empty" }] }];
    const view = { id: "v1", entity: "issue", filters: [{ field: "state", op: "in", values: ["open"] }, { field: "priority", op: "in", values: [meta.fields.priority.at(-1)!.id] }] } as Pick<View, "id" | "filters" | "entity">;
    const scopes = [
      { scope: { kind: "team" as const, id: meta.fields.team[0]!.id }, filters: [{ field: "team", op: "in", values: [meta.fields.team[0]!.id] }] as Filter[] },
      { scope: { kind: "release" as const, id: meta.currentReleaseId! }, filters: [{ field: "release", op: "in", values: [meta.currentReleaseId!] }] as Filter[] },
      { scope: { kind: "view" as const, id: "v1" }, filters: view.filters },
    ];
    for (const { scope, filters } of scopes) {
      const scoped = scopedIssues(issues, scope, [view], meta);
      const viaExplorer = runExplorer(issues, filters, [], meta);
      expect(scoped.map((i) => i.number).sort()).toEqual(viaExplorer.map((i) => i.number).sort());
      expect(scoped.length).toBeGreaterThan(0);
      const stats = insightStats(scoped, meta, triageBase);
      expect(stats.open.length).toBe(viaExplorer.filter((i) => i.state === "open").length);
      expect(stats.triage).toBe(runExplorer(issues, [...filters, ...triageBase], [], meta).length);
    }
    // The whole repo is everything.
    expect(scopedIssues(issues, { kind: "all" }, [], meta)).toBe(issues);
  });

  it("a saved view that is gone, or a PR view, is not a scope", () => {
    expect(scopeFilters({ kind: "view", id: "x" }, [])).toBeNull();
    expect(scopeFilters({ kind: "view", id: "p" }, [{ id: "p", entity: "pr", filters: [] }])).toBeNull();
  });
});

const pr = (n: number, over: Partial<ClientPr> = {}): ClientPr =>
  ({ nodeId: `PR${n}`, number: n, state: "open", isDraft: false, createdAt: "2026-10-01T00:00:00Z", reviews: [], reviewRequests: [{ kind: "user", reviewer: "bob" }], closingIssues: [], ...over }) as ClientPr;

describe("PRs waiting for review (F4)", () => {
  const now = Date.parse("2026-10-12T00:00:00Z");

  it("counts open, ready PRs asking for a review that have waited more than N days, by reviewer", () => {
    const prs = [
      pr(1), // 11 days
      pr(2, { createdAt: "2026-10-09T00:00:00Z", reviewRequests: [{ kind: "user", reviewer: "bob" }, { kind: "team", reviewer: "core" }] }), // 3 days
      pr(3, { isDraft: true }),
      pr(4, { state: "merged" }),
      pr(5, { reviewRequests: [] }),
      pr(6, { createdAt: "2026-10-11T00:00:00Z" }), // 1 day
    ];
    const by = (days: number) => waitingForReview(prs, days, now).map((g) => [g.key, g.prs.map((p) => p.number)]);
    expect(by(2)).toEqual([["user:bob", [1, 2]], ["team:core", [2]]]);
    expect(by(5)).toEqual([["user:bob", [1]]]);
    expect(by(10)).toEqual([["user:bob", [1]]]);
    expect(by(11)).toEqual([]);
  });

  it("a review starts a new wait: it counts from the latest review", () => {
    const reviewed = pr(7, { reviews: [{ author: "bob", state: "CHANGES_REQUESTED", submittedAt: "2026-10-10T00:00:00Z" }] });
    expect(waitingSince(reviewed)).toBe("2026-10-10T00:00:00Z");
    expect(waitingForReview([reviewed], 5, now)).toEqual([]);
    expect(waitingForReview([reviewed], 1, now)).toHaveLength(1);
  });

  it("a scope narrows the PRs to those that close its issues", () => {
    const prs = [pr(1, { closingIssues: ["I_a"] }), pr(2, { closingIssues: ["I_b"] }), pr(3)];
    expect(prsForIssues(prs, [{ nodeId: "I_a" }] as never).map((p) => p.number)).toEqual([1]);
  });

  it("the wait picker only takes 2, 5 or 10 days", () => {
    expect([parseWaitDays("2"), parseWaitDays("10"), parseWaitDays("7"), parseWaitDays(null)]).toEqual([2, 10, 5, 5]);
  });
});
