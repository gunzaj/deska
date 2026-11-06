// Sync generation (IMPROVEMENTS S5): a counter in sync_state bumped by every
// committed write to the GitHub cache, inside the same transaction. The web
// app reuses its hydrated read model while the generation is unchanged, and
// the data APIs use it in their ETag, so an unchanged cache costs a 304
// instead of a full payload. Task data is separate and not part of it.
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { databaseUrl, getDb } from "@/db";
import type { Tx } from "./pg-batch";

export const GENERATION_KEY = "sync.generation";

/** Without a database the data never changes within a process. */
const LOCAL_GENERATION = `local-${Date.now().toString(36)}`;

/** While a batch runs, bumps are only noted; the batch bumps once when it ends. */
const batch = new AsyncLocalStorage<{ dirty: boolean }>();

/**
 * Run `fn`, and bump the generation once afterwards if anything it wrote changed
 * the cache (v5 3.6). A sync cycle writes many pages and an outbox drain
 * refreshes many issues; each of those used to bump the generation, and every
 * instance re-read the whole cache for each bump. A reader that hydrates in the
 * middle of the batch gets newer data under the older generation, which only
 * costs it one more hydration when the batch ends, never stale data under a new
 * generation.
 */
export async function bumpGenerationOnce<T>(fn: () => Promise<T>): Promise<T> {
  // A batch inside a batch is the outer one.
  if (batch.getStore()) return fn();
  const state = { dirty: false };
  try {
    return await batch.run(state, fn);
  } finally {
    if (state.dirty) await bumpGeneration(getDb());
  }
}

/** Count one committed change to the cache. Call inside the writing transaction. */
export async function bumpGeneration(tx: Tx | ReturnType<typeof getDb>): Promise<void> {
  const open = batch.getStore();
  if (open) {
    open.dirty = true;
    return;
  }
  await tx.execute(
    sql`INSERT INTO sync_state (key, value, updated_at) VALUES (${GENERATION_KEY}, '1', now())
        ON CONFLICT (key) DO UPDATE SET value = (COALESCE(NULLIF(sync_state.value, ''), '0')::bigint + 1)::text, updated_at = now()`,
  );
}

/** The current generation ("0" before the first write). */
export async function readGeneration(): Promise<string> {
  if (!databaseUrl()) return LOCAL_GENERATION;
  const res = await getDb().execute(sql`SELECT value FROM sync_state WHERE key = ${GENERATION_KEY}`);
  return String((res.rows[0] as { value?: string } | undefined)?.value ?? "0");
}
