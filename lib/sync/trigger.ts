// One sync run under the lock: the first import while the cache has none, else
// a cycle (issue change check, project scan when due) and the daily
// reconcile when due. The in-process sync service (lib/sync/service.ts) calls
// it on an interval, on launch, on wake and on "Sync now"; "Sync now" is
// throttled so pressing it repeatedly can't run scan after scan.
import { runSyncCycle, type CycleResult, type CycleSource } from "./cycle";
import { runFirstImport, type ImportResult, type ImportSource } from "./first-import";
import { recordCycle } from "./health";
import type { ImportStore } from "./import";
import { runNightly, type NightlyResult } from "./nightly";
import type { Kv } from "./poll";
import type { ReconcileSource } from "./reconcile";
import { readSharedKv, withLockedSyncKv } from "./runtime";

/** "Sync now" right after another run is answered with "Synced just now". */
export function syncNowMinIntervalMs(raw = process.env.SYNC_NOW_MIN_INTERVAL_MS): number {
  const ms = Number(raw);
  return raw?.trim() && Number.isFinite(ms) && ms >= 0 ? ms : 5_000;
}

export type SkipReason = "sync-in-progress" | "too-soon";

export type TriggerOutcome =
  | { kind: "ran"; result: CycleResult; nightly: NightlyResult | null }
  | { kind: "imported"; result: ImportResult }
  | { kind: "skipped"; skipped: SkipReason; lastSync: string | null };

/** Whether any run (the loop, wake, Sync now) started less than `ms` ago. */
export function attemptedWithin(kv: Kv, ms: number, nowMs = Date.now()): boolean {
  const last = Date.parse(kv.get("sync.lastAttemptAt") ?? "");
  return Number.isFinite(last) && nowMs - last < ms;
}

export type TriggerOptions = {
  /** "Sync now": throttled, and allowed to force the scans (when they are over a minute old). */
  manual: boolean;
  /** Runs (or resumes) the first import while the cache has no cursor. Without it a cycle reports `needs-initial-import`. */
  importer?: ImportSource;
  /** The daily reconcile, when due. */
  reconciler?: ReconcileSource;
  /** Stops the first import between pages (the app is quitting). */
  signal?: AbortSignal;
  onProgress?: () => void;
};

/** One locked run. A skip never calls GitHub. */
export async function triggerSync(source: CycleSource, store: ImportStore, opts: TriggerOptions): Promise<TriggerOutcome> {
  if (opts.manual) {
    const kv = await readSharedKv();
    if (attemptedWithin(kv, syncNowMinIntervalMs())) {
      return { kind: "skipped", skipped: "too-soon", lastSync: kv.get("sync.lastSync") };
    }
  }
  // recordCycle sets sync.lastAttemptAt and the success/failure state (S3).
  const res = await withLockedSyncKv((kv) =>
    recordCycle(kv, async (): Promise<Exclude<TriggerOutcome, { kind: "skipped" }>> => {
      if (!kv.get("issues.since") && opts.importer) {
        return { kind: "imported", result: await runFirstImport(opts.importer, store, kv, { signal: opts.signal, onProgress: opts.onProgress }) };
      }
      const result = await runSyncCycle(source, store, kv, { forceProjectScan: opts.manual });
      // Reconcile once a day (on launch when the last one is older than that).
      // Not while rate limited or before the first import.
      const reached = result.issues.applied || result.issues.reason === "not-modified";
      const nightly = opts.reconciler && reached ? await runNightly(opts.reconciler, store, kv) : null;
      return { kind: "ran", result, nightly };
    }),
  );
  if (!res.ran) {
    const kv = await readSharedKv();
    return { kind: "skipped", skipped: "sync-in-progress", lastSync: kv.get("sync.lastSync") };
  }
  return res.value;
}
