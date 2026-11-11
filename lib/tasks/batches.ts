// Item 13: an idempotency key for one batch create. A retry after a lost
// answer finds the tasks the first request made instead of making them again.
// Memory only: it guards a retry from the same app run, not a restart.
import type { Task } from "./model";
import type { Result } from "./service";

const STORE = Symbol.for("deska.taskBatches");
type Entry = { ids: string[]; at: number };
const TTL_MS = 60 * 60_000;
const MAX = 100;
type BatchOutcome = Result<Task[]>;

function store(): Map<string, Entry> {
  const g = globalThis as Record<symbol, Map<string, Entry> | undefined>;
  return (g[STORE] ??= new Map());
}

// One batch in flight per key: a retry that arrives before the first answer
// waits for it instead of creating the same tasks again.
const RUNNING = Symbol.for("deska.taskBatchesRunning");
function running(): Map<string, Promise<BatchOutcome>> {
  const g = globalThis as Record<symbol, Map<string, Promise<BatchOutcome>> | undefined>;
  return (g[RUNNING] ??= new Map());
}

/** The batch a key is already creating, or null. */
export function batchInFlight(key: string): Promise<BatchOutcome> | null {
  return running().get(key) ?? null;
}

/** Remember the batch a key is creating until it settles. */
export function beginBatch(key: string, batch: Promise<BatchOutcome>): void {
  const r = running();
  r.set(key, batch);
  void batch.finally(() => r.delete(key)).catch(() => undefined);
}

/** The tasks a key already made, or null. Old entries are forgotten. */
export function batchIds(key: string): string[] | null {
  const s = store();
  const now = Date.now();
  for (const [k, v] of s) if (now - v.at >= TTL_MS) s.delete(k);
  const hit = s.get(key);
  return hit ? [...hit.ids] : null;
}

/** Remember the tasks one key made. The oldest entries are dropped above 100 keys. */
export function rememberBatch(key: string, ids: string[]): void {
  const s = store();
  s.set(key, { ids: [...ids], at: Date.now() });
  for (const k of [...s.keys()].slice(0, Math.max(0, s.size - MAX))) s.delete(k);
}

/** Tests only: forget every batch. */
export function __resetBatches(): void {
  store().clear();
  running().clear();
}
