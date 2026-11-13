import type { ImportOptions } from "./changes";
import type { FullSnapshot } from "./types";

export type StoreStats = {
  inserted: number;
  updated: number;
  unchanged: number;
};

/** Stores may be sync (memory/tests) or async (Postgres). */
export type MaybePromise<T> = T | Promise<T>;

/**
 * What a sync store offers: write a snapshot, manage the project scan's seen
 * list, and list the discovered fields. PostgresStore writes page-sized
 * transactions; MemoryStore (tests, demo) applies the same rules in memory.
 * The row-by-row `upsert*` methods are each store's own business, not part of
 * this contract (v5 4.4).
 */
export interface ImportStore {
  /**
   * Import a snapshot. Idempotent: re-running an identical snapshot inserts
   * and updates nothing. With `opts.scanId`, the snapshot's project items are
   * also recorded as seen by that scan (S4), in the same unit of work.
   */
  importSnapshot(snapshot: FullSnapshot, opts?: ImportOptions): Promise<StoreStats>;
  /**
   * Forget any seen list left by an earlier scan, before a fresh one starts. The
   * sync lock serializes scans, so any rows present belong to a finished or
   * abandoned scan and are dead weight.
   */
  resetScanSeen?(): MaybePromise<void>;
  /**
   * After the last page of a scan: drop cached project items the scan never
   * saw, then forget the scan's seen list. Returns how many were removed. A
   * scan that saw nothing removes nothing. With `startedAt`, only items last
   * written before the scan began are candidates: one that arrived mid-scan
   * (an outbox refresh, a page the scan had already passed) survives (v5 1.4). Only the cache changes; Deska never
   * removes items from the project itself.
   */
  pruneUnseenProjectItems(scanId: string, startedAt?: string): MaybePromise<number>;
  /**
   * A fingerprint of the label, milestone, option and iteration IDs that issues
   * and project items point at but the metadata tables don't hold (created on
   * GitHub since the last metadata fetch), or null when there are none. The
   * sync refreshes the metadata when it changes. Optional: a store without it
   * waits for the daily reconcile.
   */
  unresolvedRefs?(): MaybePromise<string | null>;
  /**
   * Point each child at its parent where both are cached (by node ID); returns
   * the pairs whose child or parent isn't cached yet. The first import uses it
   * for parents that arrive on a later page. A store that keeps parents by
   * node ID (MemoryStore) doesn't need it.
   */
  linkParents?(pairs: { child: string; parent: string }[]): Promise<{ child: string; parent: string }[]>;
  /** The discovered project fields (ID, name, type), for resolving the field map (v5 1.3). */
  listFields?(): MaybePromise<{ id: string; name: string; dataType: string }[]>;
}

/**
 * Full import. Idempotent: re-running an identical snapshot yields zero
 * inserted/updated. Renames update the name and keep the ID (comparison is by
 * GitHub ID, never by name). Pull requests in the issue list are excluded.
 */
export function importFull(snapshot: FullSnapshot, store: ImportStore, opts: ImportOptions = {}): Promise<StoreStats> {
  return store.importSnapshot(snapshot, opts);
}
