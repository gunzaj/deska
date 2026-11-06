import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FullSnapshot } from "@/lib/sync/types";
import { fixtureSnapshot } from "../fixtures/github";

const readSnapshot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sync/store-postgres", () => ({ readSnapshot }));
// The read cache keys on the sync generation (S5); a constant one here.
vi.mock("@/lib/sync/generation", () => ({ readGeneration: async () => "1" }));
vi.mock("@/lib/sync/runtime", () => ({ readStoredFieldMap: async () => null }));

const { getStore, invalidateReadCache } = await import("@/lib/store");

describe("read cache hydration", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgres://test/deska";
    invalidateReadCache();
    readSnapshot.mockReset();
  });
  afterEach(() => {
    delete process.env.DATABASE_URL;
    invalidateReadCache();
  });

  it("reads Postgres once for concurrent requests", async () => {
    // Regression: when the snapshot expired every request re-read and
    // re-imported the whole cache in parallel.
    readSnapshot.mockImplementation(async () => fixtureSnapshot());
    const [a, b, c] = await Promise.all([getStore(), getStore(), getStore()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed read", async () => {
    readSnapshot.mockRejectedValueOnce(new Error("db down")).mockImplementation(async () => fixtureSnapshot());
    await expect(getStore()).rejects.toThrow("db down");
    expect((await getStore()).issues.size).toBeGreaterThan(0);
  });

  it("does not cache a hydration that started before an invalidation", async () => {
    let release!: (s: FullSnapshot) => void;
    readSnapshot
      .mockImplementationOnce(() => new Promise<FullSnapshot>((r) => (release = r)))
      .mockImplementation(async () => fixtureSnapshot());
    const stale = getStore();
    await Promise.resolve();
    invalidateReadCache();
    release(fixtureSnapshot());
    const old = await stale;
    expect(await getStore()).not.toBe(old);
    expect(readSnapshot).toHaveBeenCalledTimes(2);
  });
});
