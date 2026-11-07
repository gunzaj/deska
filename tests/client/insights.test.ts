import { describe, expect, it } from "vitest";
import { buildClientData } from "@/lib/client/build";
import { runExplorer } from "@/lib/client/explorer";
import { hydrate } from "@/lib/client/hydrate";
import { insightStats, parseScope, scopeFilters, scopeParam, scopedIssues } from "@/lib/client/insights";
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
    expect(parseScope("dim:F1:abc")).toEqual({ kind: "dim", field: "F1", id: "abc" });
    expect(scopeParam(parseScope("dim:F1:abc"))).toBe("dim:F1:abc");
    expect(parseScope("team:abc")).toEqual({ kind: "all" });
    expect(scopeParam(parseScope("release:r:1"))).toBe("release:r:1");
    expect(scopeParam({ kind: "all" })).toBeNull();
  });

  it("scoped counts match the explorer filtered the same way (dimension, Release, saved view)", async () => {
    const data = await demo();
    const { meta, issues } = data;
    const team = meta.dimensions[0]!;
    const triageBase: Filter[] = [{ field: "state", op: "in", values: ["open"] }, { field: "any", filters: [{ field: "priority", op: "empty" }, { field: team.key, op: "empty" }] }];
    const view = { id: "v1", filters: [{ field: "state", op: "in", values: ["open"] }, { field: "priority", op: "in", values: [meta.fields.priority.at(-1)!.id] }] } as Pick<View, "id" | "filters">;
    const scopes = [
      { scope: { kind: "dim" as const, field: team.id, id: team.options[0]!.id }, filters: [{ field: team.key, op: "in", values: [team.options[0]!.id] }] as Filter[] },
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

  it("a saved view that is gone is not a scope", () => {
    expect(scopeFilters({ kind: "view", id: "x" }, [])).toBeNull();
  });
});
