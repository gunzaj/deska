import { describe, expect, it } from "vitest";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { matchesText, runView } from "@/lib/views/engine";
import { buildViewRows } from "@/lib/views/rows";
import { trySeedViews } from "@/lib/views/seeds";
import { viewSchema, type View } from "@/lib/views/view";
import { fixtureSnapshot } from "../fixtures/github";

const TODAY = "2026-10-09T00:00:00Z";

async function setup() {
  const store = new MemoryStore();
  await importFull(fixtureSnapshot(), store);
  return { store, rows: buildViewRows(store) };
}

const view = (filters: View["filters"]): View => ({
  id: "t",
  name: "t",


  layout: "list",
  filters,
  sort: [],
});

describe("OR filter groups", () => {
  it("untriaged seed = open AND (priority empty OR release empty)", async () => {
    const { store, rows } = await setup();
    const seed = trySeedViews(store).find((v) => v.id === "seed-untriaged")!;
    expect(viewSchema.parse(seed)).toBeTruthy();
    const got = runView(seed, { viewerLogin: "alice", store, todayIso: TODAY }, rows).map((r) => r.number);
    // #101 has a priority but no release — it used to be missed.
    expect(got.sort()).toEqual([101, 102]);
  });
});

describe("one board card (v5 3.8)", () => {
  it("builds the same row for one issue as the full list does", async () => {
    const { store, rows } = await setup();
    for (const r of rows) expect(buildViewRows(store, r.nodeId)).toEqual([r]);
    expect(buildViewRows(store, "I_nope")).toEqual([]);
  });
});

describe("text search", () => {
  const row = { number: 123, title: "Crash on start, stack trace" };
  it("matches #number exactly, not as a prefix", () => {
    expect(matchesText(row, "#123")).toBe(true);
    expect(matchesText(row, "#12")).toBe(false);
  });
  it("matches every word of the title, case-insensitively", () => {
    expect(matchesText(row, "crash trace")).toBe(true);
    expect(matchesText(row, "crash missing")).toBe(false);
  });
});

describe("assignee filter", () => {
  it("compares logins case-insensitively", async () => {
    const { store, rows } = await setup();
    const got = runView(
      view([{ field: "assignee", op: "in", values: ["me"] }]),
      { viewerLogin: "Alice", store, todayIso: TODAY },
      rows,
    );
    expect(got.map((r) => r.number)).toEqual([100]);
  });
});

describe("relative date filters", () => {
  it("matches created/updated within or older than N days", async () => {
    const { store, rows } = await setup();
    const ctx = { viewerLogin: "alice", store, todayIso: "2026-10-12" };
    // Fixture updatedAt: #100 Oct 1, #101 Oct 2, #102 Oct 3.
    const recent = runView(view([{ field: "updated", op: "within_days", days: 11 }]), ctx, rows).map((r) => r.number).sort();
    expect(recent).toEqual([101, 102]);
    const old = runView(view([{ field: "updated", op: "older_than_days", days: 11 }]), ctx, rows).map((r) => r.number);
    expect(old).toEqual([100]);
    expect(runView(view([{ field: "closed", op: "within_days", days: 30 }]), ctx, rows)).toEqual([]);
    expect(viewSchema.safeParse({ ...view([{ field: "created", op: "within_days", days: 0 } as never]) }).success).toBe(false);
  });
});

describe("closed-date filter", () => {
  it("matches on the issue's closedAt", async () => {
    // Regression: view rows had no closedAt, so "closed within N days" never
    // matched anything on the server.
    const snap = fixtureSnapshot();
    const bug = snap.issues.find((i) => i.number === 102)!;
    Object.assign(bug, { state: "closed", closedAt: "2026-10-05T10:00:00Z" });
    const store = new MemoryStore();
    await importFull(snap, store);
    const view: View = {
      id: "t",
      name: "t",


      layout: "list",
      filters: [{ field: "closed", op: "within_days", days: 30 }],
      sort: [],
    };
    const ctx = { viewerLogin: "alice", store, todayIso: "2026-10-12" };
    expect(runView(view, ctx, buildViewRows(store)).map((r) => r.number)).toEqual([102]);
  });
});
