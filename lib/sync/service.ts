// The in-process sync service (SPEC D5, §2.1). While the app runs it keeps the
// local cache in step with GitHub: a run on launch, every SYNC_INTERVAL_MS, on
// wake from sleep (main forwards powerMonitor's resume over IPC), when a token
// arrives, after onboarding step 2 picks a project, and on "Sync now". The
// first run on an empty cache is the first import (lib/sync/first-import.ts),
// which resumes after a quit. Read-only: nothing here writes to GitHub.
//
// One service per process, on globalThis: Next loads server modules more than
// once, and desktop/server-entry.ts (outside Next) reaches it there too.
import { dbDir } from "@/db";
import { noteSyncOk, noteSyncProblem } from "../connection";
import { demoSeed } from "../db-bootstrap";
import { localToken, tokenState } from "../github/local-token";
import { currentTarget, readMapping } from "../settings";
import { invalidateReadCache } from "../store";
import { SyncStopped } from "./cycle";
import { redactError, syncFailure, type SyncFailure } from "./health";
import { GitHubImportSource, githubReconcileSource } from "./live";
import { currentFieldMap } from "./runtime";
import { GitHubSource } from "./source-github";
import { PostgresStore } from "./store-postgres";
import { triggerSync, type TriggerOutcome } from "./trigger";

export type SyncReason = "launch" | "interval" | "wake" | "manual" | "token" | "project";

export type IdleReason = "no-token" | "no-project" | "sample-data" | "no-database" | "stopping" | "token-refused";

export type ServiceOutcome = TriggerOutcome | { kind: "idle"; reason: IdleReason } | { kind: "failed"; failure: SyncFailure; message: string };

export type ServiceState = {
  /** A run is in progress. */
  running: boolean;
  /** The last run's failure, until a run succeeds. */
  lastFailure: { failure: SyncFailure; message: string; at: string } | null;
};

/** The loop's cadence. The change check is a conditional request: an unchanged repo costs a free 304. */
export function syncIntervalMs(raw = process.env.SYNC_INTERVAL_MS): number {
  const ms = Number(raw);
  return raw?.trim() && Number.isFinite(ms) && ms >= 1_000 ? ms : 60_000;
}

/** How long quitting waits for a running page to finish writing. */
const STOP_WAIT_MS = 4_000;

class SyncService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: Promise<ServiceOutcome> | null = null;
  /** A trigger that arrived during a run: run once more afterwards. */
  private again: SyncReason | null = null;
  private controller = new AbortController();
  private stopped = false;
  /** The token generation GitHub refused with a 401: the loop waits for a new token (Sync now still tries). */
  private refusedGeneration: number | null = null;
  state: ServiceState = { running: false, lastFailure: null };

  /** Start the loop and the launch run. Idempotent. */
  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.request("interval"), syncIntervalMs());
    this.timer.unref?.();
    setTimeout(() => void this.request("launch"), 0);
  }

  /**
   * Run now, or join the run in progress. "Sync now" during a run is told so
   * (it never waits); any other trigger during a run queues one more run.
   */
  request(reason: SyncReason): Promise<ServiceOutcome> {
    if (this.stopped) return Promise.resolve({ kind: "idle", reason: "stopping" });
    if (this.current) {
      if (reason === "manual") return Promise.resolve({ kind: "skipped", skipped: "sync-in-progress", lastSync: null });
      if (reason !== "interval") this.again = reason;
      return this.current;
    }
    const run = this.runOnce(reason).finally(() => {
      this.current = null;
      this.state = { ...this.state, running: false };
      const next = this.again;
      this.again = null;
      if (next && !this.stopped) void this.request(next);
    });
    this.current = run;
    this.state = { ...this.state, running: true };
    return run;
  }

  /** Quitting: no new runs; a running import stops after its current page. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.controller.abort();
    const running = this.current;
    if (running) await Promise.race([running.catch(() => undefined), new Promise((r) => setTimeout(r, STOP_WAIT_MS))]);
  }

  /**
   * A run in progress stops after its current page and this resolves once it
   * has. The service keeps running: a reset calls this, then does its work
   * under the sync lock (lib/backup/local-data.ts).
   */
  async interrupt(): Promise<void> {
    const running = this.current;
    if (!running) return;
    this.again = null;
    this.controller.abort();
    await Promise.race([running.catch(() => undefined), new Promise((r) => setTimeout(r, STOP_WAIT_MS))]);
    if (!this.stopped) this.controller = new AbortController();
  }

  private async runOnce(reason: SyncReason): Promise<ServiceOutcome> {
    const token = localToken();
    if (!token) return { kind: "idle", reason: "no-token" };
    // A database seeded with sample data (tests, dev, preview) never mixes with GitHub's.
    if (demoSeed()) return { kind: "idle", reason: "sample-data" };
    if (!dbDir()) return { kind: "idle", reason: "no-database" };
    const target = await currentTarget();
    if (!target || (target.source === "settings" && !(await readMapping()))) return { kind: "idle", reason: "no-project" };
    const generation = tokenState().generation;
    if (reason !== "manual" && this.refusedGeneration === generation) return { kind: "idle", reason: "token-refused" };

    const store = new PostgresStore();
    const fields = await currentFieldMap(store);
    try {
      const out = await triggerSync(new GitHubSource(token, store, fields, target), store, {
        manual: reason === "manual",
        importer: new GitHubImportSource(token, target, fields),
        reconciler: githubReconcileSource(token, store, fields, target),
        signal: this.controller.signal,
      });
      if (out.kind !== "skipped") {
        this.refusedGeneration = null;
        this.state = { ...this.state, lastFailure: null };
        noteSyncOk();
        invalidateReadCache();
      }
      return out;
    } catch (e) {
      if (e instanceof SyncStopped) return { kind: "idle", reason: "stopping" };
      const failure = syncFailure(e);
      const message = redactError(e);
      console.error(`deska: sync (${reason}) failed: ${message}`);
      // The banner says so over the cached data (SPEC §3.3), right away.
      if (failure === "invalid") {
        this.refusedGeneration = generation;
        noteSyncProblem("invalid");
      } else if (failure === "offline") noteSyncProblem("offline");
      this.state = { ...this.state, lastFailure: { failure, message, at: new Date().toISOString() } };
      return { kind: "failed", failure, message };
    }
  }
}

const KEY = Symbol.for("deska.syncService");

/** What desktop/server-entry.ts calls through globalThis. */
export type SyncServiceHandle = Pick<SyncService, "request" | "stop" | "start" | "state" | "interrupt">;

/** The process's sync service (created on first use; the loop starts with `start()`). */
export function syncService(): SyncServiceHandle {
  const g = globalThis as Record<symbol, SyncServiceHandle | undefined>;
  return (g[KEY] ??= new SyncService());
}

/** Tests only. */
export async function resetSyncService(): Promise<void> {
  const g = globalThis as Record<symbol, SyncServiceHandle | undefined>;
  await g[KEY]?.stop();
  g[KEY] = undefined;
}
