import { and, eq, gte, inArray, notInArray } from "drizzle-orm";
import { databaseUrl, getDb } from "@/db";
import { issueFieldChanges, issues } from "@/db/schema";
import { BOOKKEEPING_SOURCES, type FieldChange, type TrackedField } from "@/lib/sync/changes";
import { getStore } from "@/lib/store";

export type ChangeQuery = {
  since: Date;
  fields?: TrackedField[];
  /** Only changes that set this value (a Release ID for "added to Release"). */
  newValue?: string;
  issueNodeIds?: string[];
};

/**
 * Field change history (F0), newest first. Postgres in production; the
 * in-memory store's own record in demo and fixture runs.
 */
export async function listFieldChanges(q: ChangeQuery): Promise<FieldChange[]> {
  if (!databaseUrl()) {
    const store = await getStore();
    return store.fieldChanges
      .filter(
        (c) =>
          Date.parse(c.observedAt) >= q.since.getTime() &&
          !BOOKKEEPING_SOURCES.includes(c.source) &&
          (!q.fields || q.fields.includes(c.field)) &&
          (q.newValue === undefined || c.newValue === q.newValue) &&
          (!q.issueNodeIds || q.issueNodeIds.includes(c.issueNodeId)),
      )
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  }
  // A prune and the restore after it are bookkeeping, not changes (v5 1.4).
  const conds = [gte(issueFieldChanges.observedAt, q.since), notInArray(issueFieldChanges.source, BOOKKEEPING_SOURCES)];
  if (q.fields?.length) conds.push(inArray(issueFieldChanges.field, q.fields));
  if (q.newValue !== undefined) conds.push(eq(issueFieldChanges.newValue, q.newValue));
  if (q.issueNodeIds) {
    if (!q.issueNodeIds.length) return [];
    conds.push(inArray(issues.ghNodeId, q.issueNodeIds));
  }
  const rows = await getDb()
    .select({
      node: issues.ghNodeId,
      field: issueFieldChanges.field,
      oldValue: issueFieldChanges.oldValue,
      newValue: issueFieldChanges.newValue,
      observedAt: issueFieldChanges.observedAt,
      source: issueFieldChanges.source,
    })
    .from(issueFieldChanges)
    .innerJoin(issues, eq(issues.id, issueFieldChanges.issueId))
    .where(and(...conds))
    .orderBy(issueFieldChanges.observedAt);
  return rows
    .map((r) => ({ issueNodeId: r.node!, field: r.field as TrackedField, oldValue: r.oldValue, newValue: r.newValue, observedAt: r.observedAt.toISOString(), source: r.source as FieldChange["source"] }))
    .reverse();
}
