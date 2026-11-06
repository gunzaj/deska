// Sync-cycle regressions: project-scan pruning and provisional-ID re-keying.
import { describe, expect, it } from "vitest";
import { projectScanDue, rateLimitAware, runSyncCycle, scanProject } from "@/lib/sync/cycle";
import { importFull } from "@/lib/sync/import";
import { isRateLimited, MapKv } from "@/lib/sync/poll";
import { isRateLimitError } from "@/lib/sync/source-github";
import { MemoryStore } from "@/lib/sync/store-memory";
import { partialSnapshot, type SnapshotProjectItem } from "@/lib/sync/types";
import { retryOnLimit } from "@/lib/github/client";
import { fixtureSnapshot } from "../fixtures/github";

// A scan only prunes items last written before it began (v5 1.4), so its start
// time must be later than the test's own writes.
const NOW = new Date(Date.now() + 60_000).toISOString();
const item = (itemId: string, issueNodeId: string, statusOpt: string | null): SnapshotProjectItem => ({
  itemId,
  issueNodeId,
  statusOpt,
  priorityOpt: null,

  releaseIter: null,
});

describe("project scan pruning", () => {
  it("drops cached items the full scan no longer lists", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(), store);
    const before = [...store.projectItems.keys()];
    expect(before.length).toBeGreaterThan(1);
    const [kept] = before;
    const keptItem = store.projectItems.get(kept!)!;

    // The issue was removed from the project and re-added: a new item ID. The old
    // item must not linger and compete with it for the issue's fields.
    const res = await scanProject(
      { scanProjectItems: async () => ({ items: [{ ...keptItem }, item("PVTI_new", "I_bug", "a0000002")], nextCursor: null, total: 2 }) },
      store,
      new MapKv(),
      NOW,
    );
    // PVTI_new took over I_bug's old item (one item per issue); the scan pruned the rest.
    expect(res.removed).toBe(before.length - 2);
    expect([...store.projectItems.keys()].sort()).toEqual([kept!, "PVTI_new"].sort());
  });

  it("keeps an item written after the scan began (v5 1.4)", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(), store);
    const [first] = [...store.projectItems.values()];
    await new Promise((r) => setTimeout(r, 5));
    const started = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    // A refresh lands an item for I_bug mid-scan, after the scan began; the scan never lists it.
    await importFull(partialSnapshot({ projectItems: [item("PVTI_mid", "I_bug", "a0000002")] }), store);
    const res = await scanProject({ scanProjectItems: async () => ({ items: [{ ...first! }], nextCursor: null, total: 1 }) }, store, new MapKv(), started);
    expect(store.projectItems.has("PVTI_mid")).toBe(true);
    expect(res.removed).toBeGreaterThan(0); // the other old, unseen items still go
  });

  it("a pruned item that comes back is a restore, not a field change (v5 1.4)", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(), store);
    const [first, second] = [...store.projectItems.values()];
    const started = new Date(Date.now() + 60_000).toISOString();
    await scanProject({ scanProjectItems: async () => ({ items: [{ ...first! }], nextCursor: null, total: 1 }) }, store, new MapKv(), started);
    expect(store.projectItems.has(second!.itemId)).toBe(false);

    const before = store.fieldChanges.length;
    await importFull(partialSnapshot({ projectItems: [{ ...second! }] }), store);
    const added = store.fieldChanges.slice(before);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((c) => c.source === "restore")).toBe(true);
  });

  it("clears the checkpoint before pruning, so a crash mid-prune restarts a fresh scan", async () => {
    const base = new MemoryStore();
    await importFull(fixtureSnapshot(), base);
    const items = [...base.projectItems.values()];
    const kv = new MapKv();
    class CrashingPrune extends MemoryStore {
      override pruneUnseenProjectItems(): number {
        throw new Error("crash during prune");
      }
    }
    const store = new CrashingPrune();
    // Reuse the imported items so the scan has something to prune against.
    for (const it of items) store.projectItems.set(it.itemId, it);
    const source = { scanProjectItems: async () => ({ items, nextCursor: null, total: items.length }) };
    await expect(scanProject(source, store, kv, NOW)).rejects.toThrow("crash during prune");
    // Resuming on the last page would prune everything the earlier pages saw;
    // the checkpoint must already be gone.
    expect(kv.get("project.scanCursor")).toBe("");
    expect(kv.get("project.scanId")).toBe("");
  });

  it("never wipes the cache on an empty scan", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(), store);
    const size = store.projectItems.size;
    const res = await scanProject({ scanProjectItems: async () => ({ items: [], nextCursor: null, total: 0 }) }, store, new MapKv(), NOW);
    expect(res.removed).toBe(0);
    expect(store.projectItems.size).toBe(size);
  });
});

describe("provisional IDs on pull requests", () => {
  it("re-keys a PR's provisional label and assignee once the real IDs arrive", async () => {
    const store = new MemoryStore();
    const pr = fixtureSnapshot().pullRequests![0]!;
    await importFull(
      { ...fixtureSnapshot(), issues: [], projectItems: [], pullRequests: [{ ...pr, labelIds: [store.labelId("fresh")], assigneeIds: [store.userId("newbie")] }], teams: [] },
      store,
    );
    store.upsertLabel({ id: "LA_fresh", name: "fresh", color: "", description: "" });
    store.upsertGhUser({ githubId: "U_newbie", login: "newbie", avatarUrl: null });
    const saved = store.pullRequests.get(pr.nodeId)!;
    expect(saved.labelIds).toEqual(["LA_fresh"]);
    expect(saved.assigneeIds).toEqual(["U_newbie"]);
  });
});

describe("Octokit throttling", () => {
  const opts = { method: "GET", url: "/repos/x/y/issues" };
  it("retries a short limit once, and never waits out a long one", () => {
    const handler = retryOnLimit("test");
    expect(handler(30, opts, null, 0)).toBe(true);
    expect(handler(30, opts, null, 1)).toBe(false);
    // A primary limit resetting in 40 minutes must surface as "rate limited",
    // not park the request (and a serverless function) until then.
    expect(handler(2400, opts, null, 0)).toBe(false);
  });
});

describe("GraphQL rate limits", () => {
  const gqlLimited = Object.assign(new Error("API rate limit exceeded"), { errors: [{ type: "RATE_LIMITED", message: "limit" }], headers: {} });

  it("recognises GraphQL's HTTP 200 RATE_LIMITED error", () => {
    expect(isRateLimitError(gqlLimited)).toBe(true);
    expect(isRateLimitError(Object.assign(new Error("x"), { errors: [{ type: "NOT_FOUND" }] }))).toBe(false);
  });

  it("a rate-limited scan marks the sync rate limited instead of failing", async () => {
    const kv = new MapKv();
    expect(await rateLimitAware(kv, async () => Promise.reject(gqlLimited))).toBeNull();
    expect(isRateLimited(kv)).toBe(true);
    await expect(rateLimitAware(kv, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});

describe("checkpointed project scan (S4)", () => {
  it("resumes from the stored cursor and prunes only after the last page", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(), store);
    const items = [...store.projectItems.values()];
    expect(items.length).toBeGreaterThanOrEqual(2);
    const kv = new MapKv();
    let fail = true;
    const source = {
      scanProjectItems: async (cursor: string | null) => {
        if (cursor === "c1" && fail) throw new Error("timeout");
        return cursor ? { items: [items[1]!], nextCursor: null, total: 2 } : { items: [items[0]!], nextCursor: "c1", total: 2 };
      },
    };
    await expect(scanProject(source, store, kv, NOW)).rejects.toThrow("timeout");
    expect(store.projectItems.size).toBe(items.length);
    expect(kv.get("project.scanCursor")).toBe("c1");
    fail = false;
    const res = await scanProject(source, store, kv, NOW);
    expect(res).toMatchObject({ resumed: true, pages: 1, removed: items.length - 2 });
    expect(kv.get("project.lastScan")).toBe(NOW);
  });
});

describe("runSyncCycle error handling (v5 4.3)", () => {
  const failingPoll = () => {
    const kv = new MapKv();
    kv.set("issues.since", "2026-10-01T00:00:00Z");
    const source = {
      checkChanges: async () => {
        throw Object.assign(new Error("HTTP 502 from api.github.com"), { status: 502 });
      },
      scanProjectItems: async () => ({ items: [], nextCursor: null, total: 0 }),
      scanOpenPullRequests: async () => [],
      teamMembers: async () => [],
    };
    return { kv, source };
  };

  it("throws by default (cron, Sync now)", async () => {
    const { kv, source } = failingPoll();
    await expect(runSyncCycle(source, new MemoryStore(), kv)).rejects.toThrow("502");
  });

  it("with continueOnError a failed poll is collected and the scans still run (worker)", async () => {
    const { kv, source } = failingPoll();
    const res = await runSyncCycle(source, new MemoryStore(), kv, { continueOnError: true });
    expect(res.issues).toEqual({ applied: false, reason: "error" });
    expect(res.errors).toEqual([expect.stringContaining("issues cycle: HTTP 502")]);
    expect(res.project).not.toBeNull();
    expect(res.prs).not.toBeNull();
  });

  it("without a cursor it stops before the scans in both modes", async () => {
    const { source } = failingPoll();
    for (const continueOnError of [false, true]) {
      const res = await runSyncCycle(source, new MemoryStore(), new MapKv(), { continueOnError });
      expect(res).toMatchObject({ issues: { reason: "needs-initial-import" }, project: null, prs: null, errors: [] });
    }
  });
});

describe("project scan schedule and effects", () => {
  it("is due when never run or older than the interval", () => {
    const kv = new MapKv();
    expect(projectScanDue(kv)).toBe(true);
    kv.set("project.lastScan", new Date().toISOString());
    expect(projectScanDue(kv)).toBe(false);
    expect(projectScanDue(kv, Date.now() + 10 * 3600_000)).toBe(true);
  });

  it("applies field changes and records the scan time", async () => {
    const store = new MemoryStore();
    await importFull(fixtureSnapshot(), store);
    const kv = new MapKv();
    const res = await scanProject(
      {
        scanProjectItems: async () => ({
          items: [{ itemId: "PVTI_3", issueNodeId: "I_bug", statusOpt: "a0000002", priorityOpt: null, releaseIter: null }],
          nextCursor: null,
          total: 1,
        }),
      },
      store,
      kv,
      "2026-10-09T12:00:00Z",
    );
    expect(res.updated).toBe(1);
    expect(store.projectItems.get("PVTI_3")!.statusOpt).toBe("a0000002");
    expect(kv.get("project.lastScan")).toBe("2026-10-09T12:00:00Z");
  });
});

describe("rate-limit classification", () => {
  it("treats only real rate limits as rate limits", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ status: 403, response: { headers: { "x-ratelimit-remaining": "0" } } })).toBe(true);
    expect(isRateLimitError({ status: 403, message: "You have exceeded a secondary rate limit" })).toBe(true);
    expect(isRateLimitError({ status: 403, message: "Resource not accessible by integration" })).toBe(false);
    expect(isRateLimitError({ status: 500 })).toBe(false);
  });
});
