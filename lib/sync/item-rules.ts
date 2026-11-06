// Rules for project items that every store enforces (PostgresStore in
// lib/sync/pg-batch.ts, MemoryStore in store-memory.ts); the contract test
// (tests/sync/store-contract.ts) runs both against them.

/**
 * Whether item `a` is at least as recent as `b` by GitHub's updatedAt. An
 * unknown time loses to a known one; with neither known, `a` (the newer
 * observation) wins.
 */
export function newerItem(a: { updatedAt?: string | Date | null }, b: { updatedAt?: string | Date | null }): boolean {
  const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : null;
  const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
  if (ta === null) return tb === null;
  return tb === null || ta >= tb;
}
