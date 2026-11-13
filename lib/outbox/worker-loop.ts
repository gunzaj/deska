// The in-process outbox worker (SPEC §4.8, W0). One process, one loop: every
// few seconds it drains retries and rows a crash left behind. The request that
// makes an edit still writes its own row right away (the fast path in
// lib/outbox/store.ts); this loop only picks up what the fast path could not.
//
// Writes stay off unless the §3.4 gate allows them: a gate that turned off while
// a retry waits leaves the row pending instead of failing it.
import { invalidateReadCache } from "@/lib/store";
import { writeGate } from "@/lib/writes/gate";
import { drainOutbox, recoverSending, STALE_SENDING_MS } from "./store";
import { currentDeps } from "./runtime";

const INTERVAL_MS = 5_000;

type Handle = { stop(): void };
const WORKER = Symbol.for("deska.outboxWorker");

/**
 * Start the loop once per process. A row a crash left `sending` is recovered
 * first, so its step tracking decides where it resumes.
 */
export function startOutboxWorker(): Handle {
  const g = globalThis as Record<symbol, Handle | undefined>;
  if (g[WORKER]) return g[WORKER]!;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // A row whose result could not be recorded stays `sending` with no crash
      // to recover it: after ten minutes no run still holds it.
      await recoverSending(STALE_SENDING_MS);
      const gate = await writeGate();
      if (!gate.allowed) return;
      const deps = await currentDeps();
      if (!deps) return;
      const { processed } = await drainOutbox(async () => deps);
      if (processed.length) invalidateReadCache();
    } catch (e) {
      console.error(`outbox worker: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  // A crash between the two steps of a close: resume where it stopped.
  void recoverSending()
    .then((n) => {
      if (n) console.log(`outbox: recovered ${n} unfinished row(s) after a restart`);
    })
    .catch((e: unknown) => console.error(`outbox: could not recover unfinished rows: ${e instanceof Error ? e.message : String(e)}`));
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref?.();
  const handle: Handle = { stop: () => clearInterval(timer) };
  g[WORKER] = handle;
  return handle;
}

/** Tests only: forget the running loop. */
export function resetOutboxWorker(): void {
  const g = globalThis as Record<symbol, Handle | undefined>;
  g[WORKER]?.stop();
  g[WORKER] = undefined;
}

/** A drain now, e.g. right after a write request queued followers. */
export async function drainNow(): Promise<void> {
  const gate = await writeGate();
  if (!gate.allowed) return;
  const deps = await currentDeps();
  if (!deps) return;
  await drainOutbox(async () => deps);
}
