import { describe, expect, it } from "vitest";
import { buildClientData } from "@/lib/client/build";
import { hydrate } from "@/lib/client/hydrate";
import { applyState, boardColumns, decodeState, encodeState, groupIssues, runExplorer, sameState, stateOf, withStateFilter, type ExplorerState } from "@/lib/client/explorer";
import type { View } from "@/lib/views/view";
import { DEMO_REPO, demoSnapshot } from "@/lib/demo/generate";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { buildViewRows } from "@/lib/views/rows";
import { fixtureSnapshot } from "../fixtures/github";

const NOW = new Date("2026-10-12T10:00:00Z");

async function client(snapshot = fixtureSnapshot(NOW)) {
  const store = new MemoryStore();
  await importFull(snapshot, store);
  return { store, data: hydrate(buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: NOW })) };
}

describe("client data", () => {
  it("hydrated rows match the server view rows (minus bodies)", async () => {
    const { store, data } = await client();
    const server = buildViewRows(store).sort((a, b) => a.number - b.number);
    const browser = [...data.issues].sort((a, b) => a.number - b.number);
    const pick = (r: (typeof server)[number]) => [r.number, r.statusName, r.priorityRank, r.dims, r.releaseName, r.typeName, r.labelNames, r.assignees, r.parentNumber, r.hasSubIssues];
    expect(browser.map(pick)).toEqual(server.map(pick));
  });

  it("resolves current/next/previous releases on the server clock", async () => {
    const { data } = await client();
    expect(data.meta.currentReleaseId).toBe("e0000023");
    expect(data.meta.previousReleaseId).toBe("e0000022");
    expect(data.meta.nextReleaseId).toBeNull();
  });

  it("carries GitHub's sub-issue counts per epic", async () => {
    const { data } = await client();
    const epic = data.issues.find((i) => i.number === 100)!;
    expect([epic.subTotal, epic.subCompleted]).toEqual([1, 0]);
  });

  it("uses the stored GitHub URL when it is not this repository's issue", async () => {
    const snap = fixtureSnapshot(NOW);
    const epic = snap.issues.find((i) => i.nodeId === "I_epic")!;
    epic.url = "https://github.com/other-org/other-repo/issues/4242";
    const { data } = await client(snap);
    expect(data.issues.find((i) => i.nodeId === "I_epic")!.url).toBe("https://github.com/other-org/other-repo/issues/4242");
    expect(data.issues.find((i) => i.number === 101)!.url).toBe("https://github.com/acme/widgets/issues/101");
  });

  it("sample issues do not open live acme issues or assign the signed-in user", async () => {
    const snap = demoSnapshot(NOW);
    expect(snap.issues.length).toBeGreaterThan(100);
    for (const issue of snap.issues) {
      expect(issue.url.startsWith(`https://github.com/${DEMO_REPO}/issues/`)).toBe(true);
      expect(issue.authorLogin.endsWith("-demo")).toBe(true);
    }
    for (const user of snap.ghUsers) expect(user.login.endsWith("-demo")).toBe(true);
    const store = new MemoryStore();
    await importFull(snap, store);
    const data = hydrate(buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: NOW }));
    const mine = runExplorer(data.issues, [{ field: "assignee", op: "in", values: ["me"] }], [], data.meta);
    expect(mine).toEqual([]);
    expect(data.issues.every((i) => i.url.includes(DEMO_REPO))).toBe(true);
  });

  it("keeps the wire payload compact on a realistic dataset", async () => {
    const store = new MemoryStore();
    await importFull(demoSnapshot(NOW), store);
    const wire = buildClientData(store, { viewer: "alice", writeMode: false, demo: true, now: NOW });
    const perIssue = JSON.stringify(wire).length / wire.issues.length;
    expect(perIssue).toBeLessThan(450);
  });
});

describe("explorer", () => {
  it("filters with relative releases and 'me' in the browser", async () => {
    const { data } = await client();
    const rows = runExplorer(
      data.issues,
      [
        { field: "release", op: "in", values: ["current"] },
        { field: "assignee", op: "in", values: ["me"] },
      ],
      [],
      data.meta,
    );
    expect(rows.map((r) => r.number)).toEqual([100]);
  });

  it("orders priority groups highest first and puts 'no value' last", async () => {
    const { data } = await client();
    const groups = groupIssues(data.issues, "priority", data.meta);
    expect(groups.map((g) => g.label)).toEqual(["High", "Medium", "No priority"]);
  });

  it("board columns include empty options in GitHub order", async () => {
    const { data } = await client();
    const cols = boardColumns(data.issues, "status", data.meta);
    expect(cols.map((c) => [c.label, c.rows.length])).toEqual([
      ["📋 To do", 1],
      ["🚧 In progress", 1],
      ["✅ Done", 0],
      ["No status", 1],
    ]);
  });

  it("labels a deleted option as missing and keeps it after the known ones, before 'no value'", async () => {
    const { data } = await client();
    const issues = data.issues.map((i) => (i.number === 101 ? { ...i, statusId: "deleted-opt", statusName: null, statusRank: null } : i));
    expect(groupIssues(issues, "status", data.meta).map((g) => g.label)).toEqual(["📋 To do", "Missing option", "No status"]);
    expect(boardColumns(issues, "status", data.meta).map((c) => c.label)).toEqual(["📋 To do", "🚧 In progress", "✅ Done", "Missing option", "No status"]);
    const prio = data.issues.map((i) => (i.number === 102 ? { ...i, priorityId: "deleted-opt", priorityName: null, priorityRank: null } : i));
    expect(boardColumns(prio, "priority", data.meta).map((c) => c.label)).toEqual(["High", "Medium", "Low", "Missing option"]);
  });

  it("saving a view clears grouping the state switched off", () => {
    const view: View = {
      id: "v1",
      name: "Mine",


      layout: "list",
      filters: [],
      sort: [{ field: "updated", dir: "desc" }],
      groupBy: "priority",
    };
    const { groupBy: _drop, ...ungrouped } = stateOf(view);
    void _drop;
    const saved = applyState(view, ungrouped);
    expect(saved.groupBy).toBeUndefined();
    expect(saved.id).toBe("v1");
    expect(sameState(stateOf(JSON.parse(JSON.stringify(saved))), ungrouped)).toBe(true);
  });

  it("round-trips URL state, including unicode search", () => {
    const s: ExplorerState = {
      filters: [{ field: "text", op: "contains", value: "účet ✓" }, ...withStateFilter([], "open")],
      sort: [{ field: "priority", dir: "desc" }],
      groupBy: "team",
      layout: "board",
      boardColumnsField: "release",
      columns: ["id", "status"],
    };
    expect(decodeState(encodeState(s))).toEqual(s);
    expect(sameState(decodeState(encodeState(s)) as ExplorerState, s)).toBe(true);
    expect(decodeState("not-base64!!")).toBeNull();
  });
});
