// One sync run under the lock: the first import while the cache has none, else
// a cycle (issue change check, project scan when due) and the daily
// reconcile when due. The in-process sync service (lib/sync/service.ts) calls
// it on an interval, on launch, on wake and on "Sync now"; "Sync now" is
// throttled so pressing it repeatedly can't run scan after scan.
import { rateLimitAware, runSyncCycle, type CycleResult, type CycleSource } from "./cycle";
import { runFirstImport, type ImportResult, type ImportSource } from "./first-import";
import { recordCycle, redactError } from "./health";
import { importFull, type ImportStore } from "./import";
import { runNightly, type NightlyResult } from "./nightly";
import type { Kv } from "./poll";
import type { ReconcileSource } from "./reconcile";
import { readSharedKv, withLockedSyncKv } from "./runtime";
import { partialSnapshot } from "./types";


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

/**
 * A label, milestone, Status option or sprint created on GitHub since the last
 * metadata fetch reaches the cache as a bare ID: no name, colour or dates until
 * the daily reconcile. When a cycle leaves such IDs behind, read the metadata
 * now. The fingerprint of what is still unknown afterwards is remembered, so an
 * ID GitHub's metadata never explains (a deleted label still on a cached issue)
 * costs one fetch, not one per cycle. A failure here never fails the cycle.
 */
export async function refreshUnknownMetadata(source: Pick<ReconcileSource, "fetchMetadata">, store: ImportStore, kv: Kv, opts: { fetched?: boolean } = {}): Promise<boolean> {
  if (!store.unresolvedRefs) return false;
  try {
    const before = await store.unresolvedRefs();
    if (before === (kv.get("metadata.unresolved") || null)) return false;
    let fetched = false;
    // The reconcile of this same run has just read the metadata: only note what is left.
    if (before && !opts.fetched) {
      const meta = await rateLimitAware(kv, () => source.fetchMetadata());
      if (!meta) return false;
      await importFull(partialSnapshot(meta), store);
      fetched = true;
    }
    kv.set("metadata.unresolved", (fetched ? await store.unresolvedRefs() : before) ?? "");
    return fetched;
  } catch (e) {
    console.error(`deska: metadata refresh failed: ${redactError(e)}`);
    return false;
  }
}

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
      if (opts.reconciler && reached) await refreshUnknownMetadata(opts.reconciler, store, kv, { fetched: !!nightly?.ran });
      return { kind: "ran", result, nightly };
    }),
  );
  if (!res.ran) {
    const kv = await readSharedKv();
    return { kind: "skipped", skipped: "sync-in-progress", lastSync: kv.get("sync.lastSync") };
  }
  return res.value;
}
