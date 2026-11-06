// The nightly job (IMPROVEMENTS S6, S8): the reconcile and retention, once a
// day (D5 runs it in-process on launch when the last run is over 24 h old).
// Runs under the sync lock like every other sync write.
import { runRetention, type RetentionResult } from "@/lib/maintenance/retention";
import type { ImportStore } from "./import";
import { importClosedCutoff } from "./live";
import type { Kv } from "./poll";
import { RECONCILE_INTERVAL_MS, reconcile, reconcileDue, type ReconcileResult, type ReconcileSource } from "./reconcile";

export type NightlyResult = { ran: false; reason: "not-due" } | { ran: true; reconcile: ReconcileResult; retention: RetentionResult | null };

/** Retention is idempotent, but there is no reason to redo it every trigger. */
export function retentionDue(kv: Kv, nowMs = Date.now()): boolean {
  const last = Date.parse(kv.get("retention.lastRun") ?? "");
  return !Number.isFinite(last) || nowMs - last >= RECONCILE_INTERVAL_MS;
}

/**
 * Reconcile when due (or forced). `reconcile.lastRun` is only advanced by a
 * run that finished, so a rate-limited run is retried on the next trigger. That
 * retry must not re-run retention each time: while GitHub is rate limited it has
 * nothing to do with retention, which runs on its own schedule (F8).
 */
export async function runNightly(source: ReconcileSource, store: ImportStore, kv: Kv, opts: { force?: boolean; now?: Date } = {}): Promise<NightlyResult> {
  const now = opts.now ?? new Date();
  if (!opts.force && !reconcileDue(kv, now.getTime())) return { ran: false, reason: "not-due" };
  const started = Date.now();
  const res = await reconcile(source, store, kv, { closedCutoff: importClosedCutoff(now.getTime()), now });
  // Retention needs no GitHub, so a rate-limited reconcile doesn't hold it up.
  let retention: RetentionResult | null = null;
  if (opts.force || retentionDue(kv, now.getTime())) {
    try {
      retention = await runRetention(now);
      kv.set("retention.lastRun", now.toISOString());
    } catch (e) {
      console.error(`retention failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!res.rateLimited) kv.set("reconcile.lastRun", now.toISOString());
  console.log(JSON.stringify({ kind: "reconcile", durationMs: Date.now() - started, ...res, retention }));
  return { ran: true, reconcile: res, retention };
}
