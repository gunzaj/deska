// One sync at a time (IMPROVEMENTS S1). The Vercel cron, `pnpm worker`, "Sync
// now", `pnpm sync:full` and the nightly reconcile all write the same cache;
// overlapping cycles inserted the same new issue twice (unique-key error) and
// let an older project scan prune items a newer one had just written.
//
// With a database the lock is a Postgres transaction-level advisory lock held
// by a dedicated pool client: `pg_try_advisory_xact_lock` inside an open
// transaction. A session-level `pg_try_advisory_lock` is unreliable behind
// PgBouncer in transaction mode (Neon's `-pooler` host): the unlock can land on
// a different server connection and the lock leaks. A transaction pins one
// server connection, and the lock goes away with it on commit, rollback, or a
// dropped connection. Without a database (dev, tests) it is a process-local
// flag.
import { databaseUrl, getPool } from "@/db";

/** Arbitrary constant shared by every process syncing into one database. */
export const SYNC_LOCK_KEY = 0x6465_736b; // "desk"

export type LockResult<T> = { ran: true; value: T } | { ran: false };

export type LockOptions = {
  /** Keep retrying for this long instead of giving up at once (sync:full). */
  waitMs?: number;
  /** Delay between attempts while waiting. */
  retryMs?: number;
};

let localHeld = false;

/**
 * Run `fn` only if no other sync holds the lock. Returns `{ ran: false }`
 * without calling `fn` when the lock is taken (after `waitMs`, if given). The
 * lock is always released, also when `fn` throws; the error is rethrown.
 */
export async function withSyncLock<T>(fn: () => Promise<T>, opts: LockOptions = {}): Promise<LockResult<T>> {
  const deadline = Date.now() + (opts.waitMs ?? 0);
  const retryMs = opts.retryMs ?? 2_000;
  for (;;) {
    const res = databaseUrl() ? await tryPostgres(fn) : await tryLocal(fn);
    if (res.ran || Date.now() + retryMs > deadline) return res;
    await new Promise((r) => setTimeout(r, retryMs));
  }
}

async function tryLocal<T>(fn: () => Promise<T>): Promise<LockResult<T>> {
  if (localHeld) return { ran: false };
  localHeld = true;
  try {
    return { ran: true, value: await fn() };
  } finally {
    localHeld = false;
  }
}

async function tryPostgres<T>(fn: () => Promise<T>): Promise<LockResult<T>> {
  const client = await getPool().connect();
  // A connection in an unknown state must not go back to the pool, possibly
  // still inside the transaction that holds the lock.
  let healthy = true;
  try {
    let locked = false;
    try {
      await client.query("BEGIN");
      // The lock transaction sits idle for the whole cycle (minutes), and a
      // managed Postgres' idle_in_transaction_session_timeout would kill it and
      // silently release the lock mid-cycle. Disable it for this session.
      await client.query("SET idle_in_transaction_session_timeout = 0");
      const { rows } = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_xact_lock($1) AS locked", [SYNC_LOCK_KEY]);
      locked = rows[0]?.locked === true;
      if (!locked) await client.query("ROLLBACK");
    } catch (e) {
      healthy = false;
      throw e;
    }
    if (!locked) return { ran: false };
    // A periodic no-op keeps the server connection from being reaped while `fn`
    // runs, in case the setting above is not honoured.
    const keepAlive = setInterval(() => {
      client.query("SELECT 1").catch(() => {});
    }, 30_000);
    keepAlive.unref?.();
    try {
      return { ran: true, value: await fn() };
    } finally {
      clearInterval(keepAlive);
      // The transaction only holds the lock; ending it releases the lock.
      await client.query("ROLLBACK").catch((e) => {
        healthy = false;
        console.error(`sync lock: release failed, dropping the connection: ${String(e)}`);
      });
    }
  } finally {
    client.release(healthy ? undefined : true);
  }
}
