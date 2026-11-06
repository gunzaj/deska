// S1: the "Sync now" throttle and lock; no cron entry on /api/sync-now.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));
import type { CycleSource } from "@/lib/sync/cycle";
import { getSyncKv } from "@/lib/sync/runtime";
import { MemoryStore } from "@/lib/sync/store-memory";
import { attemptedWithin, syncNowMinIntervalMs, triggerSync } from "@/lib/sync/trigger";
import { MapKv } from "@/lib/sync/poll";

function fakeSource() {
  return {
    checkChanges: vi.fn(async () => ({ kind: "not-modified" as const })),
    scanProjectItems: vi.fn(async () => ({ items: [], nextCursor: null, total: 0 })),
    scanOpenPullRequests: vi.fn(async () => []),
    teamMembers: vi.fn(async () => []),
  } satisfies CycleSource;
}

describe("triggerSync", () => {
  beforeEach(async () => {
    // After the initial import: polls only run from a cursor (S2).
    (await getSyncKv()).set("issues.since", "2026-10-01T00:00:00Z");
  });

  afterEach(async () => {
    (await getSyncKv()).set("sync.lastAttemptAt", "");
  });

  it("Sync now twice within 30 s calls the source once", async () => {
    const source = fakeSource();
    const store = new MemoryStore();
    const first = await triggerSync(source, store, { manual: true });
    expect(first.kind).toBe("ran");
    const second = await triggerSync(source, store, { manual: true });
    expect(second).toMatchObject({ kind: "skipped", skipped: "too-soon" });
    expect(source.checkChanges).toHaveBeenCalledTimes(1);
  });

  it("forces the scans on Sync now only when the last scan is over a minute old", async () => {
    const source = fakeSource();
    const store = new MemoryStore();
    const kv = await getSyncKv();
    kv.set("project.lastScan", new Date(Date.now() - 10_000).toISOString());
    kv.set("prs.lastScan", new Date(Date.now() - 10_000).toISOString());
    await triggerSync(source, store, { manual: true });
    expect(source.scanProjectItems).not.toHaveBeenCalled();
    expect(source.scanOpenPullRequests).not.toHaveBeenCalled();

    kv.set("sync.lastAttemptAt", "");
    kv.set("project.lastScan", new Date(Date.now() - 61_000).toISOString());
    kv.set("prs.lastScan", new Date(Date.now() - 61_000).toISOString());
    await triggerSync(source, store, { manual: true });
    expect(source.scanProjectItems).toHaveBeenCalledTimes(1);
    expect(source.scanOpenPullRequests).toHaveBeenCalledTimes(1);
  });

  it("does not throttle the cron", async () => {
    const source = fakeSource();
    const store = new MemoryStore();
    await triggerSync(source, store, { manual: false });
    const again = await triggerSync(source, store, { manual: false });
    expect(again.kind).toBe("ran");
    expect(source.checkChanges).toHaveBeenCalledTimes(2);
  });

  it("skips while another cycle holds the lock, without calling GitHub", async () => {
    let release!: () => void;
    const slow = fakeSource();
    slow.checkChanges.mockImplementation(() => new Promise((r) => (release = () => r({ kind: "not-modified" }))));
    const store = new MemoryStore();
    const running = triggerSync(slow, store, { manual: false });
    await vi.waitFor(() => expect(slow.checkChanges).toHaveBeenCalled());
    const other = fakeSource();
    expect(await triggerSync(other, store, { manual: false })).toMatchObject({ kind: "skipped", skipped: "sync-in-progress" });
    expect(other.checkChanges).not.toHaveBeenCalled();
    release();
    expect((await running).kind).toBe("ran");
  });

  it("parses SYNC_NOW_MIN_INTERVAL_MS with a 30 s default", () => {
    expect(syncNowMinIntervalMs(undefined)).toBe(30_000);
    expect(syncNowMinIntervalMs("")).toBe(30_000);
    expect(syncNowMinIntervalMs("abc")).toBe(30_000);
    expect(syncNowMinIntervalMs("5000")).toBe(5_000);
  });

  it("attemptedWithin ignores a missing or corrupt timestamp", () => {
    const kv = new MapKv();
    expect(attemptedWithin(kv, 30_000)).toBe(false);
    kv.set("sync.lastAttemptAt", "garbage");
    expect(attemptedWithin(kv, 30_000)).toBe(false);
    kv.set("sync.lastAttemptAt", new Date(Date.now() - 5_000).toISOString());
    expect(attemptedWithin(kv, 30_000)).toBe(true);
  });
});

describe("/api/sync-now has no cron entry (SPEC §2.5)", () => {
  it("exports only the POST handler", async () => {
    const mod = await import("@/app/api/sync-now/route");
    expect(Object.keys(mod)).toEqual(["POST"]);
  });
});
