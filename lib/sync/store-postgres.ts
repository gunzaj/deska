// Postgres-backed ImportStore + IdResolver: the sync cache the sync loop writes
// and the pages read, in the app's own PGlite database (SPEC §2.1). The
// in-memory store stays the read model (see readCache()) so the view engine is
// unchanged.
import { and, eq, getTableColumns, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  fieldOptions,
  ghUsers,
  issueAssignees,
  issueLabels,
  issueTypes,
  issues,
  issueFieldChanges,
  iterations,
  labels,
  milestones,
  projectFields,
  projectItemDims,
  projectItems,
  projectScanSeen,
} from "@/db/schema";
import type { ImportStore, StoreStats } from "./import";
import { normDims, type ImportOptions } from "./changes";
import { importSnapshot, pgWrite, single, writeTx, type Tx } from "./pg-batch";
import type { IdResolver } from "./poll";
import type {
  FullSnapshot,
  SnapshotField,
  SnapshotIssue,
  SnapshotMilestone,
  SnapshotProjectItem,
} from "./types";

type Result = "inserted" | "updated" | "unchanged";

export class PostgresStore implements ImportStore, IdResolver {
  // No node ID -> uuid cache on the instance any more (S7): the long-running
  // worker kept one for its whole lifetime, and after a cache rebuild it wrote
  // child rows against issue rows that no longer existed. The batch path
  // resolves IDs per page; the row methods below look them up each time.
  //
  // Name/login/number -> id lookups ARE cached per snapshot: building one
  // snapshot called labelId/userId once per label/assignee of every issue, a query
  // each (the initial import was tens of thousands of queries). Any metadata
  // upsert clears the cache, so a rename or a newly discovered id is never stale.
  private idCache = new Map<string, string>();

  // --- ImportStore -----------------------------------------------------
  //
  // importFull goes through importSnapshot: page-sized transactions with bulk
  // upserts that skip unchanged rows (lib/sync/pg-batch.ts, S4). The row-level
  // methods below are the same writes for a single row, each in its own
  // transaction.

  async listFields() {
    return getDb().select({ id: projectFields.id, name: projectFields.name, dataType: projectFields.dataType }).from(projectFields).where(isNull(projectFields.missingAt));
  }

  async importSnapshot(snapshot: FullSnapshot, opts: ImportOptions = {}): Promise<StoreStats> {
    const stats = await importSnapshot(snapshot, undefined, opts);
    // The batch path writes metadata without going through the upsert methods
    // above, so clear the resolver cache here too (a rename must not be stale).
    this.idCache.clear();
    return stats;
  }

  async linkParents(pairs: { child: string; parent: string }[]): Promise<{ child: string; parent: string }[]> {
    if (!pairs.length) return [];
    const unresolved: { child: string; parent: string }[] = [];
    await this.tx(async (tx) => {
      const ids = await pgWrite.uuidsOf(tx, [...new Set(pairs.map((p) => p.child))]);
      const parents = await pgWrite.uuidsOf(tx, [...new Set(pairs.map((p) => p.parent))]);
      const ready = pairs.filter((p) => {
        const ok = ids.has(p.child) && parents.has(p.parent);
        if (!ok) unresolved.push(p);
        return ok;
      });
      return pgWrite.setParents(
        tx,
        ready.map((p) => ({ nodeId: p.child, parentNodeId: p.parent }) as SnapshotIssue),
        ids,
        parents,
      );
    });
    return unresolved;
  }

  /** One transaction; bumps the sync generation when it changed anything (S5). */
  private tx(fn: (tx: Tx) => Promise<StoreStats>): Promise<StoreStats> {
    return writeTx(getDb(), fn);
  }

  private txChanged<T>(fn: (tx: Tx) => Promise<T>, changed: (r: T) => boolean): Promise<T> {
    return writeTx(getDb(), fn, changed);
  }

  async upsertField(f: SnapshotField, projectId: string, position: number): Promise<Result> {
    return single(await this.tx((tx) => pgWrite.fields(tx, [{ f, position }], projectId)));
  }

  async upsertIssueType(t: { id: string; name: string; color: string; description: string }): Promise<Result> {
    return single(await this.tx((tx) => pgWrite.issueTypes(tx, [t])));
  }

  async upsertLabel(l: { id: string; name: string; color: string; description: string }): Promise<Result> {
    this.idCache.clear();
    return single(await this.tx((tx) => pgWrite.labels(tx, [l])));
  }

  async upsertMilestone(m: SnapshotMilestone): Promise<Result> {
    this.idCache.clear();
    return single(await this.tx((tx) => pgWrite.milestones(tx, [m])));
  }

  async upsertGhUser(u: { githubId: string; login: string; avatarUrl: string | null }): Promise<Result> {
    this.idCache.clear();
    return single(await this.tx((tx) => pgWrite.users(tx, [u])));
  }

  async upsertIssue(i: SnapshotIssue): Promise<Result> {
    return single(await this.tx((tx) => pgWrite.issueRows(tx, [i])));
  }

  async linkParent(childNodeId: string, parentNodeId: string | null): Promise<"updated" | "unchanged"> {
    const childId = await this.internalId(childNodeId);
    // A parent outside the import window (old closed epic, other repo) is not
    // in the cache; treat it as no known parent rather than failing the import.
    const parentId = parentNodeId ? await this.findInternalId(parentNodeId) : null;
    const stats = await this.tx((tx) =>
      pgWrite.setParents(tx, [{ nodeId: childNodeId, parentNodeId } as SnapshotIssue], new Map([[childNodeId, childId]]), new Map(parentId && parentNodeId ? [[parentNodeId, parentId]] : [])),
    );
    return stats.updated ? "updated" : "unchanged";
  }

  async setIssueLabels(nodeId: string, labelIds: string[]): Promise<"updated" | "unchanged"> {
    const issueId = await this.internalId(nodeId);
    const touched = await this.txChanged(
      (tx) =>
        pgWrite.diffChildren(
          tx,
          issueLabels,
          "issueId",
          ["issueId", "labelId"],
          [issueId],
          [...new Set(labelIds)].map((labelId) => ({ issueId, labelId })),
        ),
      (t) => t.size > 0,
    );
    return touched.size ? "updated" : "unchanged";
  }

  async setIssueAssignees(nodeId: string, assigneeIds: string[]): Promise<"updated" | "unchanged"> {
    const issueId = await this.internalId(nodeId);
    const touched = await this.txChanged(
      (tx) =>
        pgWrite.diffChildren(
          tx,
          issueAssignees,
          "issueId",
          ["issueId", "ghUserId"],
          [issueId],
          [...new Set(assigneeIds)].map((ghUserId) => ({ issueId, ghUserId })),
        ),
      (t) => t.size > 0,
    );
    return touched.size ? "updated" : "unchanged";
  }

  async upsertProjectItem(p: SnapshotProjectItem): Promise<Result> {
    return single(await this.tx((tx) => pgWrite.itemPage(tx, [p])));
  }

  async markScanSeen(scanId: string, itemIds: string[]): Promise<void> {
    const unique = [...new Set(itemIds)];
    if (!unique.length) return;
    await getDb()
      .insert(projectScanSeen)
      .values(unique.map((ghItemId) => ({ scanId, ghItemId })))
      .onConflictDoNothing();
  }

  async resetScanSeen(): Promise<void> {
    await getDb().delete(projectScanSeen);
  }

  async pruneUnseenProjectItems(scanId: string, startedAt?: string): Promise<number> {
    return this.txChanged(async (tx) => {
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(projectScanSeen).where(eq(projectScanSeen.scanId, scanId))) as [{ n: number }];
      let removed = 0;
      // An empty scan is far more likely a misconfiguration than an empty
      // project, so it never wipes the cache.
      if (n > 0) {
        const gone = await tx
          .delete(projectItems)
          .where(
            and(
              isNotNull(projectItems.ghItemId),
              // Written after the scan began: the scan cannot have meant to miss it.
              startedAt ? lt(projectItems.syncedAt, new Date(startedAt)) : undefined,
              sql`NOT EXISTS (SELECT 1 FROM ${projectScanSeen} s WHERE s.scan_id = ${scanId} AND s.gh_item_id = ${projectItems.ghItemId})`,
            ),
          )
          .returning({ id: projectItems.id, issueId: projectItems.issueId });
        removed = gone.length;
        // Remember the prune: if the item comes back (a scan that missed it), its
        // values are not scope added (v5 1.4).
        if (gone.length) {
          await tx.insert(issueFieldChanges).values(gone.map((g) => ({ issueId: g.issueId, field: "item", oldValue: null, newValue: null, source: "prune" })));
        }
      }
      // Only this scan's list: an abandoned scan's rows are cleared when the next
      // fresh scan starts (resetScanSeen).
      await tx.delete(projectScanSeen).where(eq(projectScanSeen.scanId, scanId));
      return removed;
    }, (removed) => removed > 0);
  }

  // --- IdResolver ------------------------------------------------------

  /**
   * Look up the stored ID for a label name so an incremental REST poll reuses the
   * node ID the full import discovered. Falling straight through to the name
   * would create a duplicate row per label the first time REST reported it.
   */
  async labelId(name: string): Promise<string> {
    const key = `L:${name.toLowerCase()}`;
    const hit = this.idCache.get(key);
    if (hit !== undefined) return hit;
    const db = getDb();
    const found = await db
      .select({ id: labels.id })
      .from(labels)
      .where(sql`lower(${labels.name}) = lower(${name})`)
      .limit(1);
    const id = found[0]?.id ?? name;
    this.idCache.set(key, id);
    return id;
  }

  async userId(login: string): Promise<string> {
    const key = `U:${login.toLowerCase()}`;
    const hit = this.idCache.get(key);
    if (hit !== undefined) return hit;
    const db = getDb();
    const found = await db
      .select({ id: ghUsers.githubId })
      .from(ghUsers)
      .where(sql`lower(${ghUsers.login}) = lower(${login})`)
      .limit(1);
    const id = found[0]?.id ?? login;
    this.idCache.set(key, id);
    return id;
  }

  async milestoneId(number: number): Promise<string | null> {
    const key = `M:${number}`;
    const hit = this.idCache.get(key);
    if (hit !== undefined) return hit;
    const db = getDb();
    const found = await db.query.milestones.findFirst({ where: eq(milestones.number, number) });
    // Provisional ID ("ms:<number>") for a milestone the cache hasn't seen:
    // upsertMilestones re-keys the references to the real node ID.
    const id = found?.id ?? `ms:${number}`;
    this.idCache.set(key, id);
    return id;
  }

  // --- helpers ---------------------------------------------------------

  private async issueRowByNodeId(nodeId: string) {
    const db = getDb();
    const rows = await db.select({ id: issues.id }).from(issues).where(eq(issues.ghNodeId, nodeId)).limit(1);
    return rows[0];
  }

  private async findInternalId(nodeId: string): Promise<string | null> {
    const row = await this.issueRowByNodeId(nodeId);
    return row?.id ?? null;
  }

  private async internalId(nodeId: string): Promise<string> {
    const id = await this.findInternalId(nodeId);
    if (!id) throw new Error(`issue ${nodeId} missing from DB before relation update`);
    return id;
  }
}

// The read model carries no issue bodies (S5): at a few thousand issues
// they were several MB per instance, rebuilt in the request path. The
// panels read one body at a time (lib/server/bodies.ts).
const { body: _issueBody, ...issueColumns } = getTableColumns(issues);

/** Hydrate the in-memory read model from Postgres for the app to render. */
export async function readSnapshot(): Promise<FullSnapshot> {
  const db = getDb();
  const [fields, types, labelRows, milestoneRows, userRows, issueRows, itemRows] = await Promise.all([
    // A field GitHub no longer lists (deleted) stays out: a mapping to it is "missing" (§4.1).
    db.select().from(projectFields).where(isNull(projectFields.missingAt)),
    db.select().from(issueTypes),
    db.select().from(labels),
    db.select().from(milestones),
    db.select().from(ghUsers),
    // Deleted and aged-out issues never reach the read model: filtering here, not
    // after loading them, matters because retention never removes the rows (v5
    // 3.6). The parent's node ID comes from a join instead of a map over every row.
    db
      .select({ ...issueColumns, parentNodeId: sql<string | null>`(SELECT p.gh_node_id FROM issues p WHERE p.id = "issues"."parent_issue_id")` })
      .from(issues)
      .where(eq(issues.deleted, false)),
    // Only the items of issues that are still in the model.
    db
      .select({ ...getTableColumns(projectItems), issueNodeId: issues.ghNodeId })
      .from(projectItems)
      .innerJoin(issues, eq(issues.id, projectItems.issueId))
      .where(eq(issues.deleted, false)),
  ]);
  // Options and iterations GitHub no longer lists stay out (S6): views that
  // use them show "missing option".
  const optionRows = fields.length ? await db.select().from(fieldOptions).where(isNull(fieldOptions.missingAt)) : [];
  const iterationRows = fields.length ? await db.select().from(iterations).where(isNull(iterations.missingAt)) : [];
  // Whole tables: every row belongs to a cached issue, and an IN list of every
  // issue ID would hit Postgres' 65,535 bind-parameter limit as the cache grows.
  const labelRowsByIssue = issueRows.length ? await db.select().from(issueLabels) : [];
  const assigneeRows = issueRows.length ? await db.select().from(issueAssignees) : [];
  const dimRows = itemRows.length ? await db.select().from(projectItemDims) : [];
  const dimsBy = new Map<string, Record<string, string>>();
  for (const d of dimRows) dimsBy.set(d.itemId, { ...(dimsBy.get(d.itemId) ?? {}), [d.fieldId]: d.optionId });

  const labelsBy = new Map<string, string[]>();
  for (const l of labelRowsByIssue) {
    const arr = labelsBy.get(l.issueId) ?? [];
    arr.push(l.labelId);
    labelsBy.set(l.issueId, arr);
  }
  const assigneesBy = new Map<string, string[]>();
  for (const a of assigneeRows) {
    const arr = assigneesBy.get(a.issueId) ?? [];
    arr.push(a.ghUserId);
    assigneesBy.set(a.issueId, arr);
  }

  return {
    projectId: fields[0]?.projectId ?? "unknown",
    fields: fields.map((f) => ({
      id: f.id,
      name: f.name,
      dataType: f.dataType,
      options: optionRows
        .filter((o) => o.fieldId === f.id)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((o) => ({ id: o.id, name: o.name, color: o.color ?? "" })),
      iterations: iterationRows
        .filter((it) => it.fieldId === f.id)
        .map((it) => ({
          id: it.id,
          title: it.title,
          startDate: it.startDate,
          duration: it.durationDays,
        })),
    })),
    issueTypes: types.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color ?? "",
      description: t.description ?? "",
    })),
    labels: labelRows.map((l) => ({
      id: l.id,
      name: l.name,
      color: l.color ?? "",
      description: l.description ?? "",
    })),
    milestones: milestoneRows.map((m) => ({
      id: m.id,
      number: m.number,
      title: m.title,
      state: m.state,
      dueOn: m.dueOn ? m.dueOn.toISOString() : null,
    })),
    ghUsers: userRows.map((u) => ({
      githubId: u.githubId,
      login: u.login,
      avatarUrl: u.avatarUrl,
    })),
    // Stable order: Postgres returns rows in arbitrary order, which would make
    // the rendered lists jump around between requests.
    issues: issueRows
      .filter((i) => i.ghNodeId != null)
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
      .map((i) => ({
        nodeId: i.ghNodeId!,
        number: i.number ?? 0,
        title: i.title,
        state: i.state,
        stateReason: i.stateReason,
        typeId: i.issueTypeId,
        milestoneId: i.milestoneId,
        parentNodeId: i.parentNodeId ?? null,
        subTotal: i.subSummaryAt ? i.subTotal : null,
        subCompleted: i.subSummaryAt ? i.subCompleted : null,
        authorLogin: i.authorLogin ?? "unknown",
        url: i.url ?? "",
        createdAt: i.createdAt?.toISOString() ?? i.updatedAt?.toISOString() ?? new Date(0).toISOString(),
        updatedAt: i.updatedAt?.toISOString() ?? new Date(0).toISOString(),
        closedAt: i.closedAt?.toISOString() ?? null,
        labelIds: labelsBy.get(i.id) ?? [],
        assigneeIds: assigneesBy.get(i.id) ?? [],
      })),
    projectItems: itemRows
      .filter((p) => p.ghItemId != null && p.issueNodeId != null)
      .sort((a, b) => a.ghItemId!.localeCompare(b.ghItemId!))
      .map((p) => ({
        itemId: p.ghItemId!,
        issueNodeId: p.issueNodeId!,
        statusOpt: p.statusOpt,
        priorityOpt: p.priorityOpt,
        releaseIter: p.releaseIter,
        ...(dimsBy.has(p.id) ? { dims: normDims(dimsBy.get(p.id)) } : {}),
      })),
  };
}
