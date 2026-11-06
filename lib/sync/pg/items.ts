// Batched writes for project items, with the field change history (F0).
import * as schema from "@/db/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { projectItems } from "@/db/schema";
import { ITEM_FIELD_PROPS, RESTORE_WINDOW_MS } from "../changes";
import type { StoreStats } from "../import";
import type { SnapshotProjectItem } from "../types";
import { newerItem } from "../item-rules";
import { type ChangeRow, type Ctx, type Tx, add, changed, excludedSet, insertedFlag, lastByKey, newCtx, notOlder, recordChanges, tallyUpsert, uuidsOf } from "./sql-helpers";

// --- project items -------------------------------------------------------

export const ITEM_PROPS = ["issueId", "statusOpt", "priorityOpt", "teamOpt", "platformOpt", "releaseIter"];

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
      teamOpt: projectItems.teamOpt,
      platformOpt: projectItems.platformOpt,
      releaseIter: projectItems.releaseIter,
    })
    .from(projectItems)
    .where(
      inArray(
        projectItems.issueId,
        chosen.map((p) => ids.get(p.issueNodeId)!),
      ),
    );
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
          teamOpt: p.teamOpt,
          platformOpt: p.platformOpt,
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
      .returning({ inserted: insertedFlag });
    add(stats, tallyUpsert(group.length, ret));
  }
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
    if (ctx.fresh.has(p.issueNodeId)) continue;
    const issueId = ids.get(p.issueNodeId)!;
    const old = oldBy.get(issueId);
    for (const [field, prop] of ITEM_FIELD_PROPS) {
      const was = old?.[prop] ?? null;
      const now = p[prop] ?? null;
      if (was !== now) (restored.has(issueId) ? back : moved).push({ issueId, field, oldValue: was, newValue: now });
    }
  }
  await recordChanges(tx, moved, ctx.source);
  await recordChanges(tx, back, "restore");
  return stats;
}
