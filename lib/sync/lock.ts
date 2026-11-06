// One sync at a time (IMPROVEMENTS S1). "Sync now", the sync loop,
// `pnpm sync:full` and the nightly reconcile all write the same cache;
// overlapping cycles inserted the same new issue twice (unique-key error) and
// let an older project scan prune items a newer one had just written.
//
// The desktop app has one process and one embedded database (SPEC §2.1), so the
// lock is an in-process mutex. It replaced the Postgres advisory lock the
// hosted predecessor needed across instances.

export type LockResult<T> = { ran: true; value: T } | { ran: false };

export type LockOptions = {
  /** Keep retrying for this long instead of giving up at once (sync:full). */
  waitMs?: number;
  /** Delay between attempts while waiting. */
  retryMs?: number;
};

// On globalThis: Next.js may load this module more than once in one process
// (separate server bundles), and they must share one lock.
const HELD = Symbol.for("deska.syncLock");
const g = globalThis as unknown as Record<symbol, boolean | undefined>;

/**
 * Run `fn` only if no other sync holds the lock. Returns `{ ran: false }`
 * without calling `fn` when the lock is taken (after `waitMs`, if given). The
 * lock is always released, also when `fn` throws; the error is rethrown.
 */
export async function withSyncLock<T>(fn: () => Promise<T>, opts: LockOptions = {}): Promise<LockResult<T>> {
  const deadline = Date.now() + (opts.waitMs ?? 0);
  const retryMs = opts.retryMs ?? 2_000;
  for (;;) {
    const res = await tryLock(fn);
    if (res.ran || Date.now() + retryMs > deadline) return res;
    await new Promise((r) => setTimeout(r, retryMs));
  }
}

async function tryLock<T>(fn: () => Promise<T>): Promise<LockResult<T>> {
  if (g[HELD]) return { ran: false };
  g[HELD] = true;
  try {
    return { ran: true, value: await fn() };
  } finally {
    g[HELD] = false;
  }
}
