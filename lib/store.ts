import { databaseUrl } from "@/db";
import { ReadModel } from "./sync/read-model";
import { readGeneration } from "./sync/generation";
import { readStoredFieldMap } from "./sync/runtime";
import { readSnapshot } from "./sync/store-postgres";

/**
 * How often an instance asks Postgres whether the cache changed: one cheap
 * read of `sync.generation` (S5). The old blind 30 s TTL re-read the whole
 * cache (~14 queries, every issue and PR) whether anything had changed or not.
 */
export const GENERATION_CHECK_MS = 5_000;

type Cached = { store: ReadModel; generation: string; checkedAt: number };
let cached: Cached | null = null;
// One check/hydration at a time: concurrent requests share it.
let inflight: Promise<Cached> | null = null;
// Bumped by invalidateReadCache, so a hydration that started before an
// invalidation cannot store its result afterwards.
let epoch = 0;

async function hydrate(): Promise<ReadModel> {
  const snapshot = await readSnapshot();
  // The read model resolves Status/Release/... by the stored field IDs (v5 1.3).
  return ReadModel.fromSnapshot(snapshot, await readStoredFieldMap());
}

/** Reuse the hydrated store while the generation is unchanged, else re-read. */
async function check(): Promise<Cached> {
  const mine = epoch;
  // Read the generation before the snapshot: a sync landing in between makes
  // the stored generation older than the data, which only costs one extra
  // hydration later, never stale data under a new generation.
  const generation = await readGeneration();
  if (cached && cached.generation === generation && mine === epoch) {
    cached.checkedAt = Date.now();
    return cached;
  }
  const next: Cached = { store: await hydrate(), generation, checkedAt: Date.now() };
  if (mine === epoch) cached = next;
  return next;
}

/**
 * The store pages read, with the sync generation it was built from (the data
 * APIs put it in their ETag).
 *
 * Production reads the shared Postgres cache that `pnpm worker` writes, so the
 * web app and the worker finally see the same state. The fixture-backed demo
 * store is only ever returned when explicitly opted into — previously a cold
 * or empty sync store silently served synthetic issues to real users.
 */
export async function getStoreWithGeneration(): Promise<{ store: ReadModel; generation: string }> {
  if (databaseUrl()) {
    if (cached && Date.now() - cached.checkedAt < GENERATION_CHECK_MS) return cached;
    if (!inflight) {
      const p: Promise<Cached> = check().finally(() => {
        // A failed read is not cached: the next request tries again.
        if (inflight === p) inflight = null;
      });
      inflight = p;
    }
    return inflight;
  }
  if (demoEnabled()) {
    if (process.env.WRITE_MODE === "on") {
      // Fixture node IDs are not real issues. Writing them through the outbox
      // would push mutations against arbitrary GitHub IDs, so refuse outright.
      throw new Error(
        "Refusing to serve fixtures with WRITE_MODE=on: demo data is not writable. " +
          "Configure DATABASE_URL for a writable deployment.",
      );
    }
    const { getDemoStore } = await import("./demo/store");
    return { store: await getDemoStore(), generation: await readGeneration() };
  }
  throw new Error(
    "No data source configured: set DATABASE_URL, or DEMO=1 to run on fixtures. " +
      "Refusing to render fabricated issues.",
  );
}

export async function getStore(): Promise<ReadModel> {
  return (await getStoreWithGeneration()).store;
}

/**
 * Fixtures are for local dev and tests only. Previously the fallback triggered
 * automatically whenever the sync store was empty, so a cold production start
 * showed real users invented issues. Now it needs an explicit opt-in, or the
 * absence of a database outside production.
 */
export function demoEnabled(): boolean {
  if (process.env.DEMO === "1") return true;
  return !databaseUrl() && process.env.NODE_ENV !== "production";
}

/** Drop the hydrated snapshot (used by tests and after a manual sync). */
export function invalidateReadCache(): void {
  cached = null;
  inflight = null;
  epoch++;
}