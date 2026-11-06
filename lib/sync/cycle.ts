// One sync cycle, run by "Sync now" (and, from D5, the in-process loop):
// the cheap issue change check every time, plus the project scan when it
// is due. Project field edits (Status, Priority, Release…) may not bump the
// issue's updated_at, so without the scan they never reach the cache — which
// is what happened on Vercel, where only the issue poll ran.
import { randomUUID } from "node:crypto";
import type { ProjectFieldMap } from "./field-map";
import { importFull, type ImportStore } from "./import";
import { redactError } from "./health";
import { currentFieldMap } from "./runtime";
import { isRateLimited, pollOnce, type Kv, type PollResult, type SyncSource } from "./poll";
import { isRateLimitError, retryAfterMs, type GitHubSource } from "./source-github";
import { partialSnapshot } from "./types";

export const PROJECT_SCAN_MS = Number(process.env.SYNC_PROJECT_MS ?? 450_000);
/** Open-PR rescan (SPEC §13.1): review requests and CI may not bump updated_at. */
export const PR_SCAN_MS = Number(process.env.SYNC_PR_SCAN_MS ?? 600_000);

/**
 * "Sync now" forces the scans only when the last one is older than this, so
 * pressing it repeatedly cannot run a full project scan each time (S1).
 */
export const FORCED_SCAN_MIN_AGE_MS = 60_000;

/** What a cycle reads from GitHub; GitHubSource in production, fakes in tests. */
export type CycleSource = SyncSource &
  Pick<GitHubSource, "scanProjectItems" | "scanOpenPullRequests" | "teamMembers"> & { useFields?(map: ProjectFieldMap): void };

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
  /** `reason: "error"`: the poll threw and the cycle went on (`continueOnError`). */
  issues: PollResult | { applied: false; reason: "error" };
  project: Awaited<ReturnType<typeof scanProject>> | null;
  prs: Awaited<ReturnType<typeof scanPullRequests>> | null;
  /** Redacted failures of steps the cycle carried on past; always empty without `continueOnError`. */
  errors: string[];
};

/** Whether the scan stored under `key` is at least `minAgeMs` old (or never ran). */
export function scanOlderThan(kv: Kv, key: "project.lastScan" | "prs.lastScan", minAgeMs: number, nowMs = Date.now()): boolean {
  const last = Date.parse(kv.get(key) ?? "");
  return !Number.isFinite(last) || nowMs - last >= minAgeMs;
}

export function prScanDue(kv: Kv, nowMs = Date.now()): boolean {
  return scanOlderThan(kv, "prs.lastScan", PR_SCAN_MS, nowMs);
}

/** Rescan every open PR and the members of teams asked to review them. */
export async function scanPullRequests(
  source: Pick<GitHubSource, "scanOpenPullRequests" | "teamMembers">,
  store: ImportStore,
  kv: Kv,
  nowIso: string,
): Promise<{ prs: number; updated: number; inserted: number }> {
  const prs = await source.scanOpenPullRequests();
  const slugs = prs.flatMap((p) => p.reviewRequests.filter((r) => r.kind === "team").map((r) => r.reviewer));
  const teams = await source.teamMembers(slugs);
  const stats = await importFull(partialSnapshot({ pullRequests: prs, teams }), store);
  kv.set("prs.lastScan", nowIso);
  return { prs: prs.length, updated: stats.updated, inserted: stats.inserted };
}

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
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    kv.set("project.scanCursor", cursor);
    await kv.flush?.();
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
 * One cycle: field map, issue poll, project scan (when due), PR scan (when
 * due). The only orchestrator: "Sync now" runs it (D5 adds the in-process loop).
 * Callers hold the sync lock (withLockedSyncKv); two cycles at once race on
 * inserts and on project-item pruning.
 *
 * By default a failing step throws. With `continueOnError` (a long-running
 * loop, which must outlive a GitHub 5xx) a failing step is logged, collected in `errors`
 * (redacted) and the remaining steps still run.
 */
export async function runSyncCycle(
  source: CycleSource,
  store: ImportStore,
  kv: Kv,
  opts: { forceProjectScan?: boolean; continueOnError?: boolean } = {},
): Promise<CycleResult> {
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const errors: string[] = [];
  const step = async <T>(name: string, run: () => Promise<T>): Promise<T | null> => {
    if (!opts.continueOnError) return run();
    try {
      return await run();
    } catch (e) {
      console.error(`${name} failed: ${redactError(e)}`);
      errors.push(`${name}: ${redactError(e)}`);
      return null;
    }
  };

  await step("field map", () => refreshSourceFields(source, store, kv));
  const issues = (await step("issues cycle", () => pollOnce(source, store, kv, nowIso))) ?? { applied: false as const, reason: "error" as const };
  // The scans only update issues the cache already holds; before the initial
  // import there are none.
  if (!issues.applied && issues.reason === "needs-initial-import") return { issues, project: null, prs: null, errors };
  // While GitHub says we are rate limited, the GraphQL scans would only fail.
  const ok = () => !isRateLimited(kv);
  const forced = (key: "project.lastScan" | "prs.lastScan") =>
    !!opts.forceProjectScan && scanOlderThan(kv, key, FORCED_SCAN_MIN_AGE_MS, nowMs);
  const project =
    ok() && (forced("project.lastScan") || projectScanDue(kv, nowMs))
      ? await step("project scan", () => rateLimitAware(kv, () => scanProject(source, store, kv, nowIso)))
      : null;
  const prs =
    ok() && (forced("prs.lastScan") || prScanDue(kv, nowMs))
      ? await step("PR scan", () => rateLimitAware(kv, () => scanPullRequests(source, store, kv, nowIso)))
      : null;
  return { issues, project, prs, errors };
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
