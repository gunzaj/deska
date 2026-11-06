// The initial import into an empty cache (IMPROVEMENTS S2), shared by
// `pnpm worker` and `pnpm sync:full`. Only the worker used to seed the sync
// cursors afterwards, so a Vercel deploy seeded with `sync:full --live --db`
// had no `issues.since`: the cron's first poll paged the whole repo history
// (state=all), timed out, never advanced the cursor, and repeated every tick.
import { refreshFieldMap } from "./field-map";
import { recordCycle } from "./health";
import { importFull, type ImportStore, type StoreStats } from "./import";
import type { LockResult } from "./lock";
import type { Kv } from "./poll";
import { flushSyncKv, withLockedSyncKv } from "./runtime";
import type { FullSnapshot } from "./types";

/** `pnpm sync:full` waits this long for a running cycle before giving up (S1). */
export const SYNC_FULL_LOCK_WAIT_MS = 10 * 60_000;

/**
 * Import a full snapshot, then set the cursors a later poll and the scans
 * start from: `issues.since` (newest `updatedAt` in the snapshot),
 * `sync.lastSync`, `project.lastScan` and `prs.lastScan` (the snapshot holds
 * every project item and the open PRs). Flushes the KV before returning.
 * Callers hold the sync lock.
 */
export async function initialImport(snapshot: FullSnapshot, store: ImportStore, kv: Kv, nowIso = new Date().toISOString()): Promise<StoreStats> {
  const stats = await importFull(snapshot, store);
  refreshFieldMap(kv, snapshot.fields);
  seedCursors(snapshot, kv, nowIso);
  await flushSyncKv();
  return stats;
}

export function seedCursors(snapshot: FullSnapshot, kv: Kv, nowIso: string): void {
  const newest = snapshot.issues.reduce((m, i) => (i.updatedAt > m ? i.updatedAt : m), new Date(0).toISOString());
  kv.set("issues.since", newest);
  // A fresh cursor needs a fresh ETag; an old one could answer 304 for it.
  kv.set("issues.etag", "");
  kv.set("sync.lastSync", nowIso);
  kv.set("project.lastScan", nowIso);
  kv.set("prs.lastScan", nowIso);
}

/**
 * `pnpm sync:full`: the initial import under the sync lock (waiting for a
 * running cycle), then the same snapshot again, which must change nothing.
 */
export async function syncFull(
  snapshot: FullSnapshot,
  store: ImportStore,
  opts: { waitMs?: number; retryMs?: number } = {},
): Promise<LockResult<{ first: StoreStats; second: StoreStats }>> {
  return withLockedSyncKv(
    (kv) =>
      recordCycle(kv, async () => {
        const first = await initialImport(snapshot, store, kv);
        const second = await importFull(snapshot, store);
        return { first, second };
      }),
    { waitMs: opts.waitMs ?? SYNC_FULL_LOCK_WAIT_MS, retryMs: opts.retryMs ?? 5_000 },
  );
}
