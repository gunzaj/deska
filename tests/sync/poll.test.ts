import { describe, expect, it, vi } from "vitest";
import { runSyncCycle } from "@/lib/sync/cycle";
import { MapKv, pollOnce, type SyncSource } from "@/lib/sync/poll";
import { MemoryStore } from "@/lib/sync/store-memory";
import { fixtureSnapshot } from "../fixtures/github";

const NOW = "2026-10-09T12:00:00Z";

function sourceOf(check: Awaited<ReturnType<SyncSource["checkChanges"]>>): SyncSource {
  return { checkChanges: async () => check };
}

/** A KV after the initial import: polls only run from a cursor (S2). */
function cursorKv(): MapKv {
  const kv = new MapKv();
  kv.set("issues.since", "2026-10-01T00:00:00Z");
  return kv;
}

describe("polling without a cursor (S2)", () => {
  it("makes zero calls to the source and reports needs-initial-import", async () => {
    const store = new MemoryStore();
    const kv = new MapKv();
    const checkChanges = vi.fn(async () => ({ kind: "not-modified" as const }));
    const res = await pollOnce({ checkChanges }, store, kv, NOW);
    expect(res).toEqual({ applied: false, reason: "needs-initial-import" });
    expect(checkChanges).not.toHaveBeenCalled();
    expect(kv.get("sync.lastSync")).toBeNull();
  });

  it("runSyncCycle skips the scans too", async () => {
    const source = {
      checkChanges: vi.fn(async () => ({ kind: "not-modified" as const })),
      scanProjectItems: vi.fn(async () => ({ items: [], nextCursor: null, total: 0 })),
      scanOpenPullRequests: vi.fn(async () => []),
      teamMembers: vi.fn(async () => []),
    };
    const res = await runSyncCycle(source, new MemoryStore(), new MapKv(), { forceProjectScan: true });
    expect(res).toEqual({ issues: { applied: false, reason: "needs-initial-import" }, project: null, prs: null, errors: [] });
    expect(source.checkChanges).not.toHaveBeenCalled();
    expect(source.scanProjectItems).not.toHaveBeenCalled();
    expect(source.scanOpenPullRequests).not.toHaveBeenCalled();
  });
});

describe("incremental polling (M3)", () => {
  it("a remote change appears within one cycle", async () => {
    const store = new MemoryStore();
    const kv = cursorKv();
    const snap = fixtureSnapshot();
    const res = await pollOnce(
      sourceOf({
        kind: "changed",
        issues: snap.issues,
        items: snap.projectItems,
        etag: "etag-1",
        since: NOW,
      }),
      store,
      kv,
      NOW,
    );
    expect(res).toMatchObject({ applied: true });
    expect(store.issueCount).toBe(3);
    expect(kv.get("sync.lastSync")).toBe(NOW);
  });

  it("a 304 causes no DB writes", async () => {
    const store = new MemoryStore();
    const kv = cursorKv();
    const res = await pollOnce(sourceOf({ kind: "not-modified" }), store, kv, NOW);
    expect(res).toEqual({ applied: false, reason: "not-modified" });
    expect(store.issueCount).toBe(0);
    // A 304 is still a successful cycle, so the UI must not show a stale time.
    expect(kv.get("sync.lastSync")).toBe(NOW);
  });

  it("a simulated rate limit pauses and resumes", async () => {
    const store = new MemoryStore();
    const kv = cursorKv();
    const snap = fixtureSnapshot();
    const limited = await pollOnce(
      sourceOf({ kind: "rate-limited", retryAfterMs: 60_000 }),
      store,
      kv,
      NOW,
    );
    expect(limited).toEqual({ applied: false, reason: "rate-limited" });
    expect(store.issueCount).toBe(0);
    // retryAfter passes (kv holds a past timestamp) -> next cycle applies
    kv.set("sync.rateLimitedUntil", "0");
    const ok = await pollOnce(
      sourceOf({ kind: "changed", issues: snap.issues, items: snap.projectItems, etag: "e2", since: NOW }),
      store,
      kv,
      NOW,
    );
    expect(ok.applied).toBe(true);
    expect(store.issueCount).toBe(3);
  });
});
