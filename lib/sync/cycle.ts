// One sync cycle, run by the in-process sync service (lib/sync/service.ts):
// the cheap issue change check every time, plus the project scan when it
// is due. Project field edits (Status, Priority, Release…) may not bump the
// issue's updated_at, so without the scan they never reach the cache — which
// is what happened to the hosted predecessor, where only the issue poll ran.
import { randomUUID } from "node:crypto";
import type { ProjectFieldMap } from "./field-map";
import { importFull, type ImportStore } from "./import";
import { currentFieldMap } from "./runtime";
import { isRateLimited, pollOnce, type Kv, type PollResult, type SyncSource } from "./poll";
import { isRateLimitError, retryAfterMs, type GitHubSource } from "./source-github";
import { partialSnapshot } from "./types";

export const PROJECT_SCAN_MS = Number(process.env.SYNC_PROJECT_MS ?? 450_000);

/**
 * "Sync now" forces the scans only when the last one is older than this, so
 * pressing it repeatedly cannot run a full project scan each time (S1).
 */
export const FORCED_SCAN_MIN_AGE_MS = 60_000;

/** What a cycle reads from GitHub; GitHubSource in production, fakes in tests. */
export type CycleSource = SyncSource &
  Pick<GitHubSource, "scanProjectItems"> & { useFields?(map: ProjectFieldMap): void };

/**
 * Hand the source the field mapping once per cycle (§4.1): the confirmed one
 * from settings, by field ID (a rename is followed), or the suggestion before
 * there is one. A store that cannot list fields leaves the source's map as it was.
 */
export async function refreshSourceFields(source: { useFields?(map: ProjectFieldMap): void }, store: ImportStore, _kv?: Kv): Promise<ProjectFieldMap | null> {
  if (!store.listFields) return null;
  const map = await currentFieldMap(store);
  source.useFields?.(map);
  return map;
}

export type CycleResult = {
  issues: PollResult;
  project: Awaited<ReturnType<typeof scanProject>> | null;
};

/** Whether the scan stored under `key` is at least `minAgeMs` old (or never ran). */
export function scanOlderThan(kv: Kv, key: "project.lastScan", minAgeMs: number, nowMs = Date.now()): boolean {
  const last = Date.parse(kv.get(key) ?? "");
  return !Number.isFinite(last) || nowMs - last >= minAgeMs;
}


/** Thrown between pages when the app quits; the checkpoint makes the next run resume. */
export class SyncStopped extends Error {
  constructor() {
    super("sync stopped: the app is quitting");
    this.name = "SyncStopped";
  }
}

export type ScanOptions = {
  /** After each page is written, before the checkpoint is flushed: items on the page, the project's item count. */
  onPage?: (items: number, total: number | null) => void | Promise<void>;
  /** Stop between pages (the app is quitting). */
  signal?: AbortSignal;
};

/** Due when the interval has passed, or a scan was cut off and should resume. */
export function projectScanDue(kv: Kv, nowMs = Date.now()): boolean {
  return !!kv.get("project.scanCursor") || scanOlderThan(kv, "project.lastScan", PROJECT_SCAN_MS, nowMs);
}

/**
 * Scan every project item, one GraphQL page (100 items) at a time (S4).
 * Each page is written in its own transaction and checkpointed: the page's
 * end cursor goes to `project.scanCursor` and its items to the scan's seen
 * list. A scan cut off by the serverless time limit (or a rate limit) resumes
 * from the checkpoint on the next cycle instead of starting over, and pruning
 * waits for the last page.
 */
export async function scanProject(
  source: Pick<GitHubSource, "scanProjectItems">,
  store: ImportStore,
  kv: Kv,
  nowIso: string,
  opts: ScanOptions = {},
): Promise<{ items: number; updated: number; inserted: number; removed: number; pages: number; resumed: boolean }> {
  let cursor = kv.get("project.scanCursor") || null;
  let scanId = kv.get("project.scanId") || "";
  const resumed = !!(cursor && scanId);
  // When this scan began (a resumed one keeps its first start): the prune only
  // removes items last written before it, so one added mid-scan survives.
  let startedAt = resumed ? (kv.get("project.scanStartedAt") ?? "") : "";
  if (!resumed) {
    cursor = null;
    scanId = randomUUID();
    startedAt = nowIso;
    kv.set("project.scanId", scanId);
    kv.set("project.scanStartedAt", startedAt);
    // Drop any seen list a finished or abandoned scan left behind.
    await store.resetScanSeen?.();
  }
  let items = 0;
  let updated = 0;
  let inserted = 0;
  let pages = 0;
  for (;;) {
    const page = await source.scanProjectItems(cursor);
    const stats = await importFull(partialSnapshot({ projectItems: page.items }), store, { scanId });
    items += page.items.length;
    updated += stats.updated;
    inserted += stats.inserted;
    pages += 1;
    await opts.onPage?.(page.items.length, page.total);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    kv.set("project.scanCursor", cursor);
    await kv.flush?.();
    // Quitting: the checkpoint above is where the next launch resumes.
    if (opts.signal?.aborted) throw new SyncStopped();
  }
  // A complete scan is the whole project, so a cached item it never saw was
  // removed from the project. Kept, it pinned the old Status/Priority to the issue,
  // or competed with the issue's new item after a remove and re-add. An empty
  // scan is far more likely a misconfiguration than an empty project, so it
  // never wipes the cache.
  //
  // Forget the checkpoint *before* pruning, and flush it: if the process dies
  // during the prune, the next cycle must start a fresh full scan. Resuming on
  // the last page would re-mark only that page and then prune everything the
  // earlier pages had seen (a wiped project cache).
  kv.set("project.scanCursor", "");
  kv.set("project.scanId", "");
  kv.set("project.scanStartedAt", "");
  await kv.flush?.();
  // A resumed scan from before `scanStartedAt` existed has no start time: prune
  // nothing now (the epoch matches no row); the next full scan prunes.
  const removed = await store.pruneUnseenProjectItems(scanId, startedAt || new Date(0).toISOString());
  kv.set("project.lastScan", nowIso);
  return { items, updated, inserted, removed, pages, resumed };
}

/**
 * One cycle: field map, issue poll, project scan (when due). The only orchestrator: the in-process sync service (lib/sync/service.ts)
 * runs it on an interval, on launch, on wake and on "Sync now".
 * Callers hold the sync lock (withLockedSyncKv); two cycles at once race on
 * inserts and on project-item pruning.
 * A failing step throws; the service records it and tries again next cycle.
 */
export async function runSyncCycle(
  source: CycleSource,
  store: ImportStore,
  kv: Kv,
  opts: { forceProjectScan?: boolean } = {},
): Promise<CycleResult> {
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  await refreshSourceFields(source, store, kv);
  const issues = await pollOnce(source, store, kv, nowIso);
  // The scans only update issues the cache already holds; before the initial
  // import there are none.
  if (!issues.applied && issues.reason === "needs-initial-import") return { issues, project: null };
  // While GitHub says we are rate limited, the GraphQL scans would only fail.
  const ok = () => !isRateLimited(kv);
  const forced = (key: "project.lastScan") => !!opts.forceProjectScan && scanOlderThan(kv, key, FORCED_SCAN_MIN_AGE_MS, nowMs);
  const project =
    ok() && (forced("project.lastScan") || projectScanDue(kv, nowMs)) ? await rateLimitAware(kv, () => scanProject(source, store, kv, nowIso)) : null;
  return { issues, project };
}

/**
 * Run a GraphQL scan; a rate limit marks the sync as rate limited (the chip
 * shows it, later cycles skip the scans) instead of failing the whole cycle.
 */
export async function rateLimitAware<T>(kv: Kv, scan: () => Promise<T>): Promise<T | null> {
  try {
    return await scan();
  } catch (e) {
    if (!isRateLimitError(e)) throw e;
    kv.set("sync.rateLimitedUntil", String(Date.now() + retryAfterMs(e)));
    return null;
  }
}
