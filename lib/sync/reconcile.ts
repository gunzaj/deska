// Nightly reconcile (SPEC §3, §13.1; IMPROVEMENTS S6). The polls and scans
// only ever add and update: a deleted or transferred issue stayed "open" in the
// cache forever, closed issues never aged out, and metadata changes (renamed
// labels, removed options, new iterations) only arrived with the next import.
//
// Callers hold the sync lock (withLockedSyncKv). Postgres only: without a
// database there is no shared cache to reconcile.
import { and, eq, inArray, isNotNull, lt, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { issues, pullRequests, taskLinks } from "@/db/schema";
import { rateLimitAware } from "./cycle";
import { importFull, type ImportStore, type StoreStats } from "./import";
import { writeTx } from "./pg-batch";
import { isRateLimited, type Kv } from "./poll";
import type { FetchedNode } from "./source-github";
import { partialSnapshot, type FullSnapshot } from "./types";

/** Run at most this often (the worker checks every round, the cron daily). */
export const RECONCILE_INTERVAL_MS = 20 * 3600_000;

export interface ReconcileSource {
  /** Project fields with options and iterations, issue types, labels, milestones. */
  fetchMetadata(): Promise<Pick<FullSnapshot, "projectId" | "fields" | "issueTypes" | "labels" | "milestones">>;
  /** Node IDs of every open issue and open PR in the repo. */
  listOpenNodeIds(): Promise<{ issues: string[]; pullRequests: string[] }>;
  /** Issues/PRs by node ID; null when GitHub can't resolve the node (deleted). */
  fetchNodes(ids: string[]): Promise<Map<string, FetchedNode | null>>;
  /** `owner/name` of the synced repo, to tell a transferred issue. */
  readonly repoName: string;
}

export type ReconcileResult = {
  metadata: StoreStats | null;
  /** Cached open items GitHub no longer lists as open, re-fetched by node ID. */
  refetched: number;
  deleted: number;
  transferred: number;
  agedOut: number;
  /** Stopped early because GitHub rate limited us; the next run continues. */
  rateLimited: boolean;
};

export function reconcileDue(kv: Kv, nowMs = Date.now()): boolean {
  const last = Date.parse(kv.get("reconcile.lastRun") ?? "");
  return !Number.isFinite(last) || nowMs - last >= RECONCILE_INTERVAL_MS;
}

/**
 * 1. Re-fetch metadata and upsert it. Options and iterations GitHub no longer
 *    returns are marked missing, never deleted.
 * 2. Every cached open issue/PR missing from GitHub's open list is fetched by
 *    node ID: gone → deleted, in another repo → transferred (both marked
 *    deleted), otherwise its new state is upserted (it was closed).
 * 3. Closed issues and PRs closed before the import window are marked deleted
 *    (aged out), unless a task links them or they are the parent of a cached
 *    open issue.
 * Every step only writes what changed, so a second run writes nothing.
 */
export async function reconcile(source: ReconcileSource, store: ImportStore, kv: Kv, opts: { closedCutoff: string; now?: Date }): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();
  const result: ReconcileResult = { metadata: null, refetched: 0, deleted: 0, transferred: 0, agedOut: 0, rateLimited: false };
  const limited = () => isRateLimited(kv, now.getTime());

  if (limited()) return { ...result, rateLimited: true };
  const meta = await rateLimitAware(kv, () => source.fetchMetadata());
  if (!meta) return { ...result, rateLimited: true };
  result.metadata = await importFull(partialSnapshot(meta), store);

  const open = await rateLimitAware(kv, () => source.listOpenNodeIds());
  if (!open) return { ...result, rateLimited: true };
  const db = getDb();
  const [cachedIssues, cachedPrs] = await Promise.all([
    db.select({ nodeId: issues.ghNodeId }).from(issues).where(and(eq(issues.state, "open"), eq(issues.deleted, false), isNotNull(issues.ghNodeId))),
    db.select({ nodeId: pullRequests.ghNodeId }).from(pullRequests).where(and(eq(pullRequests.state, "open"), eq(pullRequests.deleted, false))),
  ]);
  const openOnGitHub = new Set([...open.issues, ...open.pullRequests]);
  const stale = [...cachedIssues.map((r) => r.nodeId!), ...cachedPrs.map((r) => r.nodeId)].filter((id) => !openOnGitHub.has(id));
  // An empty list next to a cache full of open issues is a token or config
  // problem, not a repo with nothing open: re-fetching everything one by one
  // would burn the budget for nothing.
  const suspicious = openOnGitHub.size === 0 && stale.length > 0;
  if (stale.length && !suspicious) {
    const fetched = await rateLimitAware(kv, () => source.fetchNodes(stale));
    if (!fetched) return { ...result, rateLimited: true };
    result.refetched = stale.length;
    const gone: { nodeId: string; reason: "deleted" | "transferred" }[] = [];
    const closedIssues: FullSnapshot["issues"] = [];
    const closedPrs: NonNullable<FullSnapshot["pullRequests"]> = [];
    const repo = source.repoName.toLowerCase();
    for (const id of stale) {
      const node = fetched.get(id) ?? null;
      if (!node) gone.push({ nodeId: id, reason: "deleted" });
      else if (node.repo.toLowerCase() !== repo) gone.push({ nodeId: id, reason: "transferred" });
      else if (node.kind === "issue") closedIssues.push(node.issue);
      else closedPrs.push(node.pr);
    }
    if (closedIssues.length || closedPrs.length) await importFull(partialSnapshot({ issues: closedIssues, pullRequests: closedPrs }), store);
    for (const reason of ["deleted", "transferred"] as const) {
      const ids = gone.filter((g) => g.reason === reason).map((g) => g.nodeId);
      const n = await markDeleted(ids, reason);
      if (reason === "deleted") result.deleted = n;
      else result.transferred = n;
    }
  } else if (suspicious) {
    console.warn(`reconcile: GitHub lists no open issues or PRs but ${stale.length} are cached open; skipping the deletion check`);
  }

  result.agedOut = await ageOut(opts.closedCutoff);
  return result;
}

/** Split a list so an IN list stays under Postgres' bind-parameter limit. */
function* chunk<T>(rows: T[], size = 5_000): Generator<T[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

/** Mark these issue/PR node IDs deleted (only rows not deleted yet). */
async function markDeleted(nodeIds: string[], reason: "deleted" | "transferred"): Promise<number> {
  if (!nodeIds.length) return 0;
  const db = getDb();
  let total = 0;
  for (const batch of chunk(nodeIds)) {
    total += await writeTx(
      db,
      async (tx) => {
        const a = await tx
          .update(issues)
          .set({ deleted: true, deletedReason: reason })
          .where(and(inArray(issues.ghNodeId, batch), eq(issues.deleted, false)))
          .returning({ id: issues.id });
        const b = await tx
          .update(pullRequests)
          .set({ deleted: true, deletedReason: reason })
          .where(and(inArray(pullRequests.ghNodeId, batch), eq(pullRequests.deleted, false)))
          .returning({ id: pullRequests.id });
        return a.length + b.length;
      },
      (n) => n > 0,
    );
  }
  return total;
}

/**
 * Closed issues and PRs closed before `cutoff` leave the read model, except
 * ones a task links and parents of a cached open issue. Rows are kept (with
 * deleted_reason "aged-out"), so a link or the detail panel still resolves
 * them, and a later poll that sees them change brings them back.
 */
async function ageOut(cutoff: string): Promise<number> {
  const db = getDb();
  const before = new Date(cutoff);
  const linked = db.select({ id: taskLinks.targetNodeId }).from(taskLinks);
  const openParents = db
    .select({ id: issues.parentIssueId })
    .from(issues)
    .where(and(eq(issues.state, "open"), eq(issues.deleted, false), isNotNull(issues.parentIssueId)));
  // Select first, so a run with nothing to do sends no UPDATE.
  const [issueIds, prIds] = await Promise.all([
    db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.deleted, false),
          eq(issues.state, "closed"),
          lt(issues.closedAt, before),
          or(sql`${issues.ghNodeId} IS NULL`, notInArray(issues.ghNodeId, linked)),
          sql`${issues.id} NOT IN (${openParents})`,
        ),
      ),
    db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(and(eq(pullRequests.deleted, false), inArray(pullRequests.state, ["closed", "merged"]), lt(pullRequests.closedAt, before), notInArray(pullRequests.ghNodeId, linked))),
  ]);
  if (!issueIds.length && !prIds.length) return 0;
  return writeTx(
    db,
    async (tx) => {
      let n = 0;
      for (const batch of chunk(issueIds)) {
        n += (
          await tx
            .update(issues)
            .set({ deleted: true, deletedReason: "aged-out" })
            .where(
              and(
                inArray(
                  issues.id,
                  batch.map((r) => r.id),
                ),
                eq(issues.deleted, false),
              ),
            )
            .returning({ id: issues.id })
        ).length;
      }
      for (const batch of chunk(prIds)) {
        n += (
          await tx
            .update(pullRequests)
            .set({ deleted: true, deletedReason: "aged-out" })
            .where(
              and(
                inArray(
                  pullRequests.id,
                  batch.map((r) => r.id),
                ),
                eq(pullRequests.deleted, false),
              ),
            )
            .returning({ id: pullRequests.id })
        ).length;
      }
      return n;
    },
    (n) => n > 0,
  );
}
