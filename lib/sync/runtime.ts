// Sync runtime. Key/value sync state (ETag, since, lastSync, the first
// import's checkpoint) lives in the sync_state table when DESKA_DB_DIR is set,
// so it survives a relaunch. Without a database it falls back to a
// process-local map (dev/tests only).
import { dbDir, getDb } from "@/db";
import { syncState } from "@/db/schema";
import { bumpGenerationOnce } from "./generation";
import { readMapping } from "../settings";
import { effectiveMapping, type FieldMapping } from "./field-map";
import { consecutiveFailures } from "./health";
import { withSyncLock, type LockOptions, type LockResult } from "./lock";
import { MapKv, type Kv } from "./poll";
import { IMPORT_KEYS, importProgress, type ImportProgress } from "./import-state";

const syncKv: Kv = new MapKv();

/** Postgres-backed Kv; reads are cached in-process to avoid a query per call. */
class DbKv implements Kv {
  private cache = new Map<string, string | null>();

  get(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  /** The last queued write per key; each write waits for the one before it. */
  private pending = new Map<string, Promise<void>>();
  /** Failed writes since the last flush: a lost cursor must not look healthy. */
  private errors: Error[] = [];

  set(key: string, value: string): void {
    this.cache.set(key, value);
    // Fire-and-forget, but never as an unhandled rejection: one failed write
    // must not crash the server. Writes to one key are chained so
    // an older value can never land after a newer one.
    const prev = this.pending.get(key) ?? Promise.resolve();
    const p: Promise<void> = prev
      .then(() => this.persist(key, value))
      .catch((e) => {
        this.errors.push(e instanceof Error ? e : new Error(String(e)));
        console.error(`sync_state write failed for ${key}: ${String(e)}`);
      })
      .finally(() => {
        if (this.pending.get(key) === p) this.pending.delete(key);
      });
    this.pending.set(key, p);
  }

  /**
   * Wait for queued writes (a checkpoint must be on disk before the next page).
   * Throws if any write failed, so a lost cursor or checkpoint surfaces as a
   * failed cycle instead of a silently "healthy" one.
   */
  async flush(): Promise<void> {
    await Promise.all([...this.pending.values()]);
    if (this.errors.length) {
      const failed = this.errors;
      this.errors = [];
      throw new Error(`sync_state write failed: ${failed.map((e) => e.message).join("; ")}`);
    }
  }

  /** Re-read from the database (the maintainer's `sync:full --db` CLI writes it from another process). */
  async refresh(keys: string[]): Promise<void> {
    if (!dbDir()) return;
    // Our own queued writes must land first, or the re-read resurrects the
    // previous cursor.
    await this.flush();
    const db = getDb();
    const rows = await db.select().from(syncState);
    const found = new Map(rows.map((r) => [r.key, r.value]));
    for (const k of keys) this.cache.set(k, found.get(k) ?? null);
  }

  private async persist(key: string, value: string): Promise<void> {
    const db = getDb();
    await db
      .insert(syncState)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: syncState.key, set: { value, updatedAt: new Date() } });
  }
}

/**
 * Every key a sync cycle reads. A key missing here is never re-read from the
 * database, so after a relaunch it would read as null (and the scan it
 * gates would run again on every start).
 */
const SHARED_KEYS = [
  "issues.since",
  "issues.etag",
  "sync.lastSync",
  "sync.lastAttemptAt",
  "sync.lastError",
  "sync.consecutiveFailures",
  "sync.rateLimitedUntil",
  "project.lastScan",
  "project.scanCursor",
  "project.scanId",
  "project.scanStartedAt",
  "reconcile.lastRun",
  "retention.lastRun",
  ...Object.values(IMPORT_KEYS),
];

let dbKv: DbKv | null = null;

/** Persist any queued sync_state writes. No-op without a database. */
export async function flushSyncKv(): Promise<void> {
  await dbKv?.flush();
}

/** The KV a sync cycle should use: shared when a database is configured. */
export async function getSyncKv(): Promise<Kv> {
  if (!dbDir()) return syncKv;
  if (!dbKv) dbKv = new DbKv();
  await dbKv.refresh(SHARED_KEYS);
  return dbKv;
}

/**
 * Run `fn` under the sync lock (lib/sync/lock.ts) with the KV re-read after the
 * lock is taken, so it sees the cursors the previous holder left. Queued KV
 * writes land before the lock is released: otherwise the next holder, in
 * another process, could read the cursor this cycle had already moved on.
 */
export async function withLockedSyncKv<T>(fn: (kv: Kv) => Promise<T>, opts?: LockOptions): Promise<LockResult<T>> {
  // One generation bump for the whole locked unit, not one per page (v5 3.6).
  return withSyncLock(
    () =>
      bumpGenerationOnce(async () => {
        const kv = await getSyncKv();
        try {
          return await fn(kv);
        } finally {
          await flushSyncKv();
        }
      }),
    opts,
  );
}

/**
 * Read keys straight from the database, without touching the shared `dbKv` cache a
 * running cycle is using (a status request used to overwrite its in-memory values).
 */
async function readShared(keys: string[]): Promise<Map<string, string | null>> {
  if (!dbDir()) return new Map(keys.map((k) => [k, syncKv.get(k)]));
  const rows = await getDb().select().from(syncState);
  const found = new Map(rows.map((r) => [r.key, r.value]));
  return new Map(keys.map((k) => [k, found.get(k) ?? null]));
}

/** Whether the first import finished (it sets the poll cursor last). */
export async function initialImportDone(): Promise<boolean> {
  return !!(await readShared(["issues.since"])).get("issues.since");
}

/** Read-only sync state for the status chip. */
export async function readSyncState(): Promise<{
  lastSync: string | null;
  rateLimitedUntil: string | null;
  needsInitialImport: boolean;
  lastAttemptAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** The first import's progress while it hasn't finished. */
  importProgress: ImportProgress;
}> {
  const state = await readShared(SHARED_KEYS);
  const kv = new MapKv();
  for (const [k, v] of state) if (v != null) kv.set(k, v);
  return {
    importProgress: importProgress(kv),
    lastSync: state.get("sync.lastSync") ?? null,
    rateLimitedUntil: state.get("sync.rateLimitedUntil") ?? null,
    // Polls refuse to run without a cursor until the first import is done (S2).
    needsInitialImport: !state.get("issues.since"),
    lastAttemptAt: state.get("sync.lastAttemptAt") || null,
    lastError: state.get("sync.lastError") || null,
    consecutiveFailures: consecutiveFailures(kv),
  };
}
/**
 * The field mapping sync and writes run on (§4.1): the one the user confirmed
 * (lib/settings.ts), with names followed through renames, or before there is
 * one (tests, dev) the suggestion from the discovered fields.
 */
export async function currentFieldMap(store: { listFields?(): Promise<{ id: string; name: string; dataType: string }[]> | { id: string; name: string; dataType: string }[] }): Promise<FieldMapping> {
  return effectiveMapping(await readMapping(), (await store.listFields?.()) ?? []);
}

/**
 * A snapshot of the shared keys, for reading outside the sync lock. Unlike
 * `getSyncKv` it never touches the process-wide cache a running cycle is using:
 * that refresh could overwrite the cycle's in-memory `rateLimitedUntil` or
 * failure counter, and its flush swallowed the cycle's own write errors (v5 2.4).
 */
export async function readSharedKv(): Promise<Kv> {
  const state = await readShared(SHARED_KEYS);
  const kv = new MapKv();
  for (const [k, v] of state) if (v != null) kv.set(k, v);
  return kv;
}
