// Batched writes for issues: rows, labels, assignees and parent links.
import { and, inArray, sql } from "drizzle-orm";
import { issueAssignees, issueLabels, issues } from "@/db/schema";
import { setValue } from "../changes";
import type { StoreStats } from "../import";
import type { SnapshotIssue } from "../types";
import { type ChangeRow, type Ctx, type Tx, add, changed, diffChildren, emptyStats, excludedSet, insertedFlag, newCtx, notOlder, recordChanges, tallyUpsert, uuidsOf } from "./sql-helpers";

// --- issues ---------------------------------------------------------------

export const ISSUE_PROPS = [
  "number",
  "title",
  "state",
  "stateReason",
  "milestoneId",
  "authorLogin",
  "url",
  "createdAt",
  "updatedAt",
  "closedAt",
  "deleted",
  "deletedReason",
] as const;
// subTotal/subCompleted (and subSummaryAt) join the written columns only when
// the payload carries a summary (see upsertIssueRows).

export function issueValues(i: SnapshotIssue) {
  return {
    ghNodeId: i.nodeId,
    number: i.number,
    title: i.title,
    body: i.body ?? null,
    state: i.state,
    stateReason: i.stateReason,
    issueTypeId: i.typeId ?? null,
    subTotal: i.subTotal ?? null,
    subCompleted: i.subCompleted ?? null,
    subSummaryAt: i.subTotal == null ? null : new Date(),
    milestoneId: i.milestoneId,
    authorLogin: i.authorLogin,
    url: i.url,
    createdAt: new Date(i.createdAt),
    updatedAt: new Date(i.updatedAt),
    closedAt: i.closedAt ? new Date(i.closedAt) : null,
    syncedAt: new Date(),
    // Seen on GitHub again, so it is not deleted (any more).
    deleted: false,
    deletedReason: null,
  };
}

/**
 * Issue rows. A missing `typeId` (REST payloads) or `body` keeps the stored
 * value, so rows are grouped by which of the two they carry and each group's
 * statement leaves the absent columns alone.
 */
export async function upsertIssueRows(tx: Tx, list: SnapshotIssue[], ctx: Ctx = newCtx()): Promise<StoreStats> {
  const stats = emptyStats();
  const before = list.length
    ? await tx
        .select({ id: issues.id, nodeId: issues.ghNodeId, state: issues.state })
        .from(issues)
        .where(inArray(issues.ghNodeId, [...new Set(list.map((i) => i.nodeId))]))
    : [];
  const was = new Map(before.map((r) => [r.nodeId!, r]));
  for (const i of list) if (!was.has(i.nodeId)) ctx.fresh.add(i.nodeId);
  const groups = new Map<string, { props: string[]; rows: SnapshotIssue[] }>();
  for (const i of list) {
    const props: string[] = [...ISSUE_PROPS];
    if (i.typeId !== undefined) props.push("issueTypeId");
    if (i.body !== undefined) props.push("body");
    if (i.subTotal !== undefined) props.push("subTotal", "subCompleted");
    const key = props.join(",");
    const g = groups.get(key) ?? { props, rows: [] };
    g.rows.push(i);
    groups.set(key, g);
  }
  for (const { props, rows } of groups.values()) {
    const ret = await tx
      .insert(issues)
      .values(rows.map(issueValues))
      .onConflictDoUpdate({
        target: issues.ghNodeId,
        // The read time follows whenever the counts are written, but never
        // makes a row look changed by itself.
        set: { ...excludedSet(issues, props.includes("subTotal") ? [...props, "subSummaryAt"] : props), syncedAt: sql`excluded.synced_at` },
        setWhere: and(changed(issues, props), notOlder(issues)),
      })
      .returning({ inserted: insertedFlag });
    add(stats, tallyUpsert(rows.length, ret));
  }
  const moved: ChangeRow[] = [];
  for (const i of list) {
    const b = was.get(i.nodeId);
    if (b && b.state !== i.state) moved.push({ issueId: b.id, field: "state", oldValue: b.state, newValue: i.state });
  }
  await recordChanges(tx, moved, ctx.source);
  return stats;
}

/**
 * One page of issues in one transaction: rows, labels, assignees, and parent
 * links whose parent is already cached. Returns the parent links that must
 * wait for a later page (their parent wasn't written yet).
 */
export async function importIssuePage(tx: Tx, page: SnapshotIssue[], ctx: Ctx = newCtx()): Promise<{ stats: StoreStats; deferred: SnapshotIssue[] }> {
  const stats = emptyStats();
  add(stats, await upsertIssueRows(tx, page, ctx));
  const ids = await uuidsOf(
    tx,
    page.map((i) => i.nodeId),
  );
  const owners = page.map((i) => ids.get(i.nodeId)!);

  const labelChanges = new Map<string, { old: string[]; new: string[] }>();
  const assigneeChanges = new Map<string, { old: string[]; new: string[] }>();
  const labelTouched = await diffChildren(
    tx,
    issueLabels,
    "issueId",
    ["issueId", "labelId"],
    owners,
    page.flatMap((i) => [...new Set(i.labelIds)].map((labelId) => ({ issueId: ids.get(i.nodeId)!, labelId }))),
    { valueProp: "labelId", into: labelChanges },
  );
  const assigneeTouched = await diffChildren(
    tx,
    issueAssignees,
    "issueId",
    ["issueId", "ghUserId"],
    owners,
    page.flatMap((i) => [...new Set(i.assigneeIds)].map((ghUserId) => ({ issueId: ids.get(i.nodeId)!, ghUserId }))),
    { valueProp: "ghUserId", into: assigneeChanges },
  );
  const freshIds = new Set(page.filter((i) => ctx.fresh.has(i.nodeId)).map((i) => ids.get(i.nodeId)!));
  const setChanges = (field: "labels" | "assignees", from: Map<string, { old: string[]; new: string[] }>): ChangeRow[] =>
    [...from]
      .filter(([owner]) => !freshIds.has(owner))
      .map(([issueId, v]) => ({ issueId, field, oldValue: setValue(v.old), newValue: setValue(v.new) }))
      .filter((r) => r.oldValue !== r.newValue);
  await recordChanges(tx, [...setChanges("labels", labelChanges), ...setChanges("assignees", assigneeChanges)], ctx.source);
  for (const id of owners) {
    stats[labelTouched.has(id) ? "updated" : "unchanged"] += 1;
    stats[assigneeTouched.has(id) ? "updated" : "unchanged"] += 1;
  }

  // A partial (REST) payload omits parentNodeId: only relink when told.
  const linking = page.filter((i) => i.parentNodeId !== undefined);
  const parents = await uuidsOf(
    tx,
    linking.flatMap((i) => (i.parentNodeId ? [i.parentNodeId] : [])),
  );
  const now = linking.filter((i) => !i.parentNodeId || parents.has(i.parentNodeId));
  add(stats, await setParents(tx, now, ids, parents));
  return { stats, deferred: linking.filter((i) => i.parentNodeId && !parents.has(i.parentNodeId)) };
}

/**
 * Point children at their parents. A parent outside the cache (an old closed
 * epic, another repo) counts as no parent rather than failing the import.
 */
export async function setParents(tx: Tx, list: SnapshotIssue[], ids: Map<string, string>, parents: Map<string, string>): Promise<StoreStats> {
  if (!list.length) return emptyStats();
  const rows = list.map((i) => ({ id: ids.get(i.nodeId)!, parent: i.parentNodeId ? (parents.get(i.parentNodeId) ?? null) : null }));
  // Compare first: an unchanged link must not cost an UPDATE statement.
  const current = await tx
    .select({ id: issues.id, parent: issues.parentIssueId })
    .from(issues)
    .where(
      inArray(
        issues.id,
        rows.map((r) => r.id),
      ),
    );
  const now = new Map(current.map((r) => [r.id, r.parent]));
  const diff = rows.filter((r) => (now.get(r.id) ?? null) !== r.parent);
  if (diff.length) {
    const values = sql.join(
      diff.map((r) => sql`(${r.id}::uuid, ${r.parent}::uuid)`),
      sql`, `,
    );
    await tx.execute(sql`UPDATE issues SET parent_issue_id = v.parent FROM (VALUES ${values}) AS v(id, parent) WHERE issues.id = v.id`);
  }
  return { inserted: 0, updated: diff.length, unchanged: rows.length - diff.length };
}
