// Batched writes for project items, with the field change history (F0).
import * as schema from "@/db/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { projectItemDims, projectItems } from "@/db/schema";
import { dimChanges, ITEM_FIELD_PROPS, normDims, RESTORE_WINDOW_MS } from "../changes";
import type { StoreStats } from "../import";
import type { SnapshotProjectItem } from "../types";
import { newerItem } from "../item-rules";
import { type ChangeRow, type Ctx, type Tx, add, changed, excludedSet, insertedFlag, lastByKey, newCtx, notOlder, recordChanges, tallyUpsert, uuidsOf } from "./sql-helpers";

// --- project items -------------------------------------------------------

export const ITEM_PROPS = ["issueId", "statusOpt", "priorityOpt", "releaseIter"];

/**
 * A page of project items. Items whose issue isn't cached (other repos, old
 * closed issues) are skipped. One item per issue (S7): when GitHub reports two
 * for the same issue, the most recently updated one is kept and the other is
 * dropped (logged).
 */
export async function importItemPage(tx: Tx, page: SnapshotProjectItem[], ctx: Ctx = newCtx()): Promise<StoreStats> {
  const list = lastByKey(page, (p) => p.itemId);
  const ids = await uuidsOf(
    tx,
    list.map((p) => p.issueNodeId),
  );
  const known = list.filter((p) => ids.has(p.issueNodeId));
  const stats: StoreStats = { inserted: 0, updated: 0, unchanged: list.length - known.length };

  const byIssue = new Map<string, SnapshotProjectItem>();
  for (const p of known) {
    const cur = byIssue.get(p.issueNodeId);
    if (cur) {
      const keep = newerItem(p, cur) ? p : cur;
      console.warn(`project items: issue ${p.issueNodeId} has two project items (${cur.itemId}, ${p.itemId}); keeping ${keep.itemId}`);
      byIssue.set(p.issueNodeId, keep);
      stats.unchanged += 1;
    } else byIssue.set(p.issueNodeId, p);
  }
  let chosen = [...byIssue.values()];
  if (!chosen.length) return stats;

  // An item already stored for the issue under another item ID.
  const others = await tx
    .select({
      id: projectItems.id,
      itemId: projectItems.ghItemId,
      issueId: projectItems.issueId,
      updatedAt: projectItems.updatedAt,
      statusOpt: projectItems.statusOpt,
      priorityOpt: projectItems.priorityOpt,
      releaseIter: projectItems.releaseIter,
    })
    .from(projectItems)
    .where(
      inArray(
        projectItems.issueId,
        chosen.map((p) => ids.get(p.issueNodeId)!),
      ),
    );
  // The stored single-select values of those items, before anything below replaces them.
  const oldDimRows = others.length
    ? await tx.select().from(projectItemDims).where(inArray(projectItemDims.itemId, others.map((o) => o.id)))
    : [];
  const oldDims = new Map<string, Record<string, string>>();
  for (const d of oldDimRows) oldDims.set(d.itemId, { ...(oldDims.get(d.itemId) ?? {}), [d.fieldId]: d.optionId });
  const incomingByIssue = new Map(chosen.map((p) => [ids.get(p.issueNodeId)!, p]));
  const replace: string[] = [];
  const skip = new Set<string>();
  for (const o of others) {
    const p = incomingByIssue.get(o.issueId)!;
    if (o.itemId === p.itemId) continue;
    if (newerItem(p, o)) replace.push(o.id);
    else skip.add(p.itemId);
    console.warn(`project items: issue ${p.issueNodeId} has two project items (${o.itemId}, ${p.itemId}); keeping ${newerItem(p, o) ? p.itemId : o.itemId}`);
  }
  if (replace.length) {
    await tx.delete(projectItems).where(inArray(projectItems.id, replace));
    stats.updated += replace.length;
  }
  if (skip.size) {
    chosen = chosen.filter((p) => !skip.has(p.itemId));
    stats.unchanged += skip.size;
  }

  const written = new Set<string>();
  // Items without updatedAt (fixtures, older payloads) keep the stored one.
  for (const withTime of [true, false]) {
    const group = chosen.filter((p) => (p.updatedAt !== undefined) === withTime);
    if (!group.length) continue;
    const props = withTime ? [...ITEM_PROPS, "updatedAt"] : ITEM_PROPS;
    const ret = await tx
      .insert(projectItems)
      .values(
        group.map((p) => ({
          ghItemId: p.itemId,
          issueId: ids.get(p.issueNodeId)!,
          statusOpt: p.statusOpt,
          priorityOpt: p.priorityOpt,
          releaseIter: p.releaseIter,
          updatedAt: p.updatedAt ? new Date(p.updatedAt) : null,
          syncedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: projectItems.ghItemId,
        set: { ...excludedSet(projectItems, props), syncedAt: sql`excluded.synced_at` },
        setWhere: and(changed(projectItems, props), notOlder(projectItems)),
      })
      .returning({ inserted: insertedFlag, itemId: projectItems.ghItemId });
    add(stats, tallyUpsert(group.length, ret));
    for (const r of ret) if (r.itemId) written.add(r.itemId);
  }
  // Single-select and iteration values by field ID (§4.1): diffed, so an unchanged item writes nothing.
  const rowIds = await tx
    .select({ id: projectItems.id, itemId: projectItems.ghItemId, updatedAt: projectItems.updatedAt })
    .from(projectItems)
    .where(inArray(projectItems.ghItemId, chosen.map((p) => p.itemId)));
  const rowIdOf = new Map(rowIds.map((r) => [r.itemId!, r.id]));
  // A stale payload (older than the stored item) leaves its values alone, like the row itself.
  const staleItem = new Set(rowIds.filter((r) => !written.has(r.itemId!) && r.updatedAt && chosen.some((p) => p.itemId === r.itemId && p.updatedAt && new Date(p.updatedAt) < r.updatedAt!)).map((r) => r.itemId!));
  const curDimRows = rowIds.length ? await tx.select().from(projectItemDims).where(inArray(projectItemDims.itemId, rowIds.map((r) => r.id))) : [];
  const curDims = new Map<string, Map<string, string>>();
  for (const d of curDimRows) curDims.set(d.itemId, (curDims.get(d.itemId) ?? new Map()).set(d.fieldId, d.optionId));
  const dimUpserts: { itemId: string; fieldId: string; optionId: string }[] = [];
  const dimDeletes: { itemId: string; fieldId: string }[] = [];
  const dimTouched = new Set<string>();
  for (const p of chosen) {
    const rowId = rowIdOf.get(p.itemId);
    if (!rowId || staleItem.has(p.itemId)) continue;
    const want = normDims(p.dims) ?? {};
    const have = curDims.get(rowId) ?? new Map<string, string>();
    for (const [fieldId, optionId] of Object.entries(want)) {
      if (have.get(fieldId) !== optionId) {
        dimUpserts.push({ itemId: rowId, fieldId, optionId });
        dimTouched.add(p.itemId);
      }
    }
    for (const fieldId of have.keys()) {
      if (!(fieldId in want)) {
        dimDeletes.push({ itemId: rowId, fieldId });
        dimTouched.add(p.itemId);
      }
    }
  }
  for (const d of dimDeletes) await tx.delete(projectItemDims).where(and(eq(projectItemDims.itemId, d.itemId), eq(projectItemDims.fieldId, d.fieldId)));
  if (dimUpserts.length) {
    await tx
      .insert(projectItemDims)
      .values(dimUpserts)
      .onConflictDoUpdate({ target: [projectItemDims.itemId, projectItemDims.fieldId], set: { optionId: sql`excluded.option_id` } });
  }
  // An item whose only change is a dimension value still counts as updated.
  const dimOnly = [...dimTouched].filter((id) => !written.has(id)).length;
  stats.unchanged -= dimOnly;
  stats.updated += dimOnly;
  // F0: what the issue's project fields were before this page, against what they are now.
  const oldBy = new Map(others.map((o) => [o.issueId, o]));
  // An item that has no row but was pruned a moment ago is a scan's mistake
  // coming back, not scope added: its values go in as `restore`, which readers
  // of the history ignore (v5 1.4).
  const noRow = chosen.map((p) => ids.get(p.issueNodeId)!).filter((id) => !oldBy.has(id));
  const restored = new Set<string>();
  if (noRow.length) {
    const tombs = await tx
      .select({ id: schema.issueFieldChanges.id, issueId: schema.issueFieldChanges.issueId })
      .from(schema.issueFieldChanges)
      .where(
        and(
          inArray(schema.issueFieldChanges.issueId, noRow),
          eq(schema.issueFieldChanges.field, "item"),
          eq(schema.issueFieldChanges.source, "prune"),
          gte(schema.issueFieldChanges.observedAt, new Date(Date.now() - RESTORE_WINDOW_MS)),
        ),
      );
    for (const t of tombs) restored.add(t.issueId);
    if (tombs.length) await tx.delete(schema.issueFieldChanges).where(inArray(schema.issueFieldChanges.id, tombs.map((t) => t.id)));
  }
  const moved: ChangeRow[] = [];
  const back: ChangeRow[] = [];
  for (const p of chosen) {
    // A stale payload (older than the stored item) changed nothing, so it records nothing.
    if (ctx.fresh.has(p.issueNodeId) || staleItem.has(p.itemId)) continue;
    const issueId = ids.get(p.issueNodeId)!;
    const old = oldBy.get(issueId);
    for (const [field, prop] of ITEM_FIELD_PROPS) {
      const was = old?.[prop] ?? null;
      const now = p[prop] ?? null;
      if (was !== now) (restored.has(issueId) ? back : moved).push({ issueId, field, oldValue: was, newValue: now });
    }
    for (const c of dimChanges(old ? oldDims.get(old.id) : undefined, normDims(p.dims))) (restored.has(issueId) ? back : moved).push({ issueId, ...c });
  }
  await recordChanges(tx, moved, ctx.source);
  await recordChanges(tx, back, "restore");
  return stats;
}
