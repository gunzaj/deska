// The sync cycle behind POST/GET /api/sync-now: the lock, plus the "Sync now"
// throttle (IMPROVEMENTS S1). Any signed-in user can press the button, and
// each press used to force a full project scan on the shared GITHUB_TOKEN.
import { runSyncCycle, type CycleResult, type CycleSource } from "./cycle";
import { recordCycle } from "./health";
import type { ImportStore } from "./import";
import type { Kv } from "./poll";
import { readSharedKv, withLockedSyncKv } from "./runtime";

export function syncNowMinIntervalMs(raw = process.env.SYNC_NOW_MIN_INTERVAL_MS): number {
  const ms = Number(raw);
  return raw?.trim() && Number.isFinite(ms) && ms >= 0 ? ms : 30_000;
}

export type SkipReason = "sync-in-progress" | "too-soon";

export type TriggerOutcome =
  | { kind: "ran"; result: CycleResult }
  | { kind: "skipped"; skipped: SkipReason; lastSync: string | null };

/** Whether any cycle (cron, worker, Sync now) started less than `ms` ago. */
export function attemptedWithin(kv: Kv, ms: number, nowMs = Date.now()): boolean {
  const last = Date.parse(kv.get("sync.lastAttemptAt") ?? "");
  return Number.isFinite(last) && nowMs - last < ms;
}

/**
 * One locked cycle. `manual` is the "Sync now" button: throttled by
 * SYNC_NOW_MIN_INTERVAL_MS and allowed to force the scans (when they are older
 * than a minute). A skip never calls GitHub.
 */
export async function triggerSync(source: CycleSource, store: ImportStore, opts: { manual: boolean }): Promise<TriggerOutcome> {
  if (opts.manual) {
    const kv = await readSharedKv();
    if (attemptedWithin(kv, syncNowMinIntervalMs())) {
      return { kind: "skipped", skipped: "too-soon", lastSync: kv.get("sync.lastSync") };
    }
  }
  // recordCycle sets sync.lastAttemptAt and the success/failure state (S3).
  const res = await withLockedSyncKv((kv) => recordCycle(kv, () => runSyncCycle(source, store, kv, { forceProjectScan: opts.manual })));
  if (!res.ran) {
    const kv = await readSharedKv();
    return { kind: "skipped", skipped: "sync-in-progress", lastSync: kv.get("sync.lastSync") };
  }
  return { kind: "ran", result: res.value };
}
