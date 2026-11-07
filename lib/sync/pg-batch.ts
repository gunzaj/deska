// Batched Postgres writes for the sync cache (IMPROVEMENTS S4). The store used
// to write row by row (~3 queries per project item, an UPDATE even when
// nothing changed) with no transactions, so a full project scan could run out
// of serverless time and a crash mid-issue left new labels next to old fields.
//
// Here every page of up to 100 rows is one transaction:
// - rows are upserted with INSERT … ON CONFLICT DO UPDATE … WHERE (cols) IS
//   DISTINCT FROM (excluded cols), so an unchanged row is not rewritten, and
//   RETURNING (xmax = 0) tells inserted from updated;
// - child rows (labels, assignees…) are diffed: only the rows
//   that changed are deleted or inserted.
// A re-import of an unchanged snapshot therefore issues no UPDATE or DELETE.
//
// The per-table writes live in lib/sync/pg/ (sql-helpers, metadata, issues,
// items); this file is the entry point that orders them (v5 4.5).
import { getDb } from "@/db";
import { projectScanSeen } from "@/db/schema";
import type { ImportOptions } from "./changes";
import { bumpGeneration } from "./generation";
import type { StoreStats } from "./import";
import type { FullSnapshot, SnapshotIssue } from "./types";
import { type Db, type Result, type Tx, add, diffChildren, emptyStats, lastByKey, newCtx, pages, uuidsOf } from "./pg/sql-helpers";
import { upsertFields, upsertIssueTypes, upsertLabels, upsertMilestones, upsertUsers } from "./pg/metadata";
import { importIssuePage, setParents, upsertIssueRows } from "./pg/issues";
import { importItemPage } from "./pg/items";

export type { Tx };

// --- entry point ---------------------------------------------------------

/**
 * Import a snapshot (full or partial) in page-sized transactions. Metadata
 * first, then issues page by page (parent links to a parent on a later page
 * are set in a final pass), then project items. Pull requests in the issue
 * list are excluded, like importFull.
 */
export async function importSnapshot(snapshot: FullSnapshot, db: Db = getDb(), opts: ImportOptions = {}): Promise<StoreStats> {
  const stats = emptyStats();
  const ctx = newCtx(opts);
  const page = async (fn: (tx: Tx) => Promise<StoreStats>) => add(stats, await writeTx(db, fn));
  if (snapshot.fields.length || snapshot.issueTypes.length || snapshot.labels.length || snapshot.milestones.length || snapshot.ghUsers.length) {
    await page(async (tx) => {
      const s = emptyStats();
      add(
        s,
        await upsertFields(
          tx,
          snapshot.fields.map((f, position) => ({ f, position })),
          snapshot.projectId,
          true,
        ),
      );
      add(s, await upsertIssueTypes(tx, snapshot.issueTypes));
      add(s, await upsertLabels(tx, snapshot.labels));
      add(s, await upsertMilestones(tx, snapshot.milestones));
      add(s, await upsertUsers(tx, snapshot.ghUsers));
      return s;
    });
  }

  const realIssues = lastByKey(
    snapshot.issues.filter((i) => !i.isPullRequest),
    (i) => i.nodeId,
  );
  const deferred: SnapshotIssue[] = [];
  for (const rows of pages(realIssues)) {
    await page(async (tx) => {
      const res = await importIssuePage(tx, rows, ctx);
      deferred.push(...res.deferred);
      return res.stats;
    });
  }
  for (const rows of pages(deferred)) {
    await page(async (tx) => {
      const ids = await uuidsOf(
        tx,
        rows.map((i) => i.nodeId),
      );
      const parents = await uuidsOf(
        tx,
        rows.map((i) => i.parentNodeId!),
      );
      return setParents(tx, rows, ids, parents);
    });
  }

  for (const rows of pages(snapshot.projectItems)) {
    await page(async (tx) => {
      const s = await importItemPage(tx, rows, ctx);
      // Record the scan's seen items in the same transaction as the items, so a
      // crash can't leave the seen list out of step with what was written (F6).
      if (opts.scanId && rows.length) {
        await tx
          .insert(projectScanSeen)
          .values([...new Set(rows.map((r) => r.itemId))].map((ghItemId) => ({ scanId: opts.scanId!, ghItemId })))
          .onConflictDoNothing();
      }
      return s;
    });
  }
  return stats;
}

/**
 * One write transaction. When it changed anything, the sync generation is
 * bumped in the same transaction, so readers never see new data under an old
 * generation (S5).
 */
export async function writeTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, changedOf: (r: T) => boolean = (r) => isChange(r as StoreStats)): Promise<T> {
  return db.transaction(async (tx) => {
    const r = await fn(tx);
    if (changedOf(r)) await bumpGeneration(tx);
    return r;
  });
}

const isChange = (s: StoreStats) => s.inserted > 0 || s.updated > 0;

/**
 * The single-row writes behind PostgresStore's ImportStore methods, each in
 * its own transaction. importSnapshot (above) is the bulk path instead; these keep the
 * store usable row by row (tests, one-off fixes).
 */
export const pgWrite = {
  fields: upsertFields,
  issueTypes: upsertIssueTypes,
  labels: upsertLabels,
  milestones: upsertMilestones,
  users: upsertUsers,
  issueRows: upsertIssueRows,
  itemPage: importItemPage,
  uuidsOf,
  diffChildren,
  setParents,
};

/** The one-row result of a batch write. */
export function single(stats: StoreStats): Result {
  return stats.inserted ? "inserted" : stats.updated ? "updated" : "unchanged";
}
