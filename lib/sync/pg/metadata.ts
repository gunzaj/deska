// Batched writes for labels, users, milestones, issue types and project fields.
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { fieldOptions, ghUsers, issueAssignees, issueLabels, issueTypes, issues, iterations, labels, milestones, prAssignees, prLabels, projectFields, pullRequests } from "@/db/schema";
import type { StoreStats } from "../import";
import type { FullSnapshot, SnapshotField } from "../types";
import { type Result, type Tx, changed, emptyStats, excludedSet, insertedFlag, lastByKey, tallyUpsert } from "./sql-helpers";

// --- metadata -------------------------------------------------------------

/**
 * Point issue and PR references from one label/user ID to another. A
 * reference that would duplicate one already on the new ID is dropped first,
 * or the UPDATE would violate the primary key.
 */
export async function rekey(tx: Tx, kind: "label" | "user" | "milestone", fromId: string, toId: string) {
  const targets =
    kind === "label"
      ? [
          { table: sql.raw("issue_labels"), owner: sql.raw("issue_id"), ref: sql.raw("label_id") },
          { table: sql.raw("pr_labels"), owner: sql.raw("pr_id"), ref: sql.raw("label_id") },
        ]
      : kind === "user"
        ? [
            { table: sql.raw("issue_assignees"), owner: sql.raw("issue_id"), ref: sql.raw("gh_user_id") },
            { table: sql.raw("pr_assignees"), owner: sql.raw("pr_id"), ref: sql.raw("gh_user_id") },
          ]
        : [
            { table: sql.raw("issues"), owner: sql.raw("id"), ref: sql.raw("milestone_id") },
            { table: sql.raw("pull_requests"), owner: sql.raw("id"), ref: sql.raw("milestone_id") },
          ];
  for (const { table, owner, ref } of targets) {
    await tx.execute(sql`DELETE FROM ${table} a WHERE a.${ref} = ${fromId} AND EXISTS (SELECT 1 FROM ${table} b WHERE b.${owner} = a.${owner} AND b.${ref} = ${toId})`);
    await tx.execute(sql`UPDATE ${table} SET ${ref} = ${toId} WHERE ${ref} = ${fromId}`);
  }
}

/** IDs among `candidates` that issue or PR rows still reference. */
export async function referenced(tx: Tx, kind: "label" | "user", candidates: string[]): Promise<Set<string>> {
  if (!candidates.length) return new Set();
  const [a, b] =
    kind === "label"
      ? await Promise.all([
          tx.selectDistinct({ id: issueLabels.labelId }).from(issueLabels).where(inArray(issueLabels.labelId, candidates)),
          tx.selectDistinct({ id: prLabels.labelId }).from(prLabels).where(inArray(prLabels.labelId, candidates)),
        ])
      : await Promise.all([
          tx.selectDistinct({ id: issueAssignees.ghUserId }).from(issueAssignees).where(inArray(issueAssignees.ghUserId, candidates)),
          tx.selectDistinct({ id: prAssignees.ghUserId }).from(prAssignees).where(inArray(prAssignees.ghUserId, candidates)),
        ]);
  return new Set([...a, ...b].map((r) => r.id));
}

export async function upsertLabels(tx: Tx, rows: FullSnapshot["labels"]): Promise<StoreStats> {
  // One label per name too: labels.name is unique.
  const list = lastByKey(lastByKey(rows, (l) => l.id), (l) => l.name.toLowerCase());
  if (!list.length) return emptyStats();
  // A row with the same name under another ID (a provisional name-keyed row, or
  // a label deleted and recreated on GitHub) gives way to the real one.
  const dupes = await tx
    .select({ id: labels.id, name: labels.name })
    .from(labels)
    .where(sql`lower(${labels.name}) IN (${sql.join(list.map((l) => sql`${l.name.toLowerCase()}`), sql`, `)})`);
  const byName = new Map(list.map((l) => [l.name.toLowerCase(), l.id]));
  const incoming = new Set(list.map((l) => l.id));
  // Re-keys change what issues show, so they count as updates (and bump the
  // sync generation).
  let rekeyed = 0;
  for (const d of dupes) {
    const real = byName.get(d.name.toLowerCase())!;
    if (d.id === real) continue;
    if (incoming.has(d.id)) {
      // A real label that is itself being renamed (names swapped on GitHub):
      // park it on a unique name so the upsert below can't hit labels.name.
      await tx.update(labels).set({ name: `${d.name} (renaming ${d.id})` }).where(eq(labels.id, d.id));
      continue;
    }
    await rekey(tx, "label", d.id, real);
    await tx.delete(labels).where(eq(labels.id, d.id));
    rekeyed += 1;
  }
  // IdResolver.labelId() hands out the bare name for an unseen label without a
  // row, so those references are re-keyed when the real ID arrives.
  const bare = list.filter((l) => l.id !== l.name);
  const refs = await referenced(
    tx,
    "label",
    bare.map((l) => l.name),
  );
  for (const l of bare) {
    if (!refs.has(l.name)) continue;
    await rekey(tx, "label", l.name, l.id);
    rekeyed += 1;
  }

  const props = ["name", "color", "description"];
  const ret = await tx
    .insert(labels)
    .values(list.map((l) => ({ id: l.id, name: l.name, color: l.color, description: l.description })))
    .onConflictDoUpdate({ target: labels.id, set: excludedSet(labels, props), setWhere: changed(labels, props) })
    .returning({ inserted: insertedFlag });
  const stats = tallyUpsert(list.length, ret);
  stats.updated += rekeyed;
  return stats;
}

export async function upsertUsers(tx: Tx, rows: FullSnapshot["ghUsers"]): Promise<StoreStats> {
  const list = lastByKey(lastByKey(rows, (u) => u.githubId), (u) => u.login.toLowerCase());
  if (!list.length) return emptyStats();
  const dupes = await tx
    .select({ id: ghUsers.githubId, login: ghUsers.login })
    .from(ghUsers)
    .where(sql`lower(${ghUsers.login}) IN (${sql.join(list.map((u) => sql`${u.login.toLowerCase()}`), sql`, `)})`);
  const byLogin = new Map(list.map((u) => [u.login.toLowerCase(), u.githubId]));
  const incoming = new Set(list.map((u) => u.githubId));
  let rekeyed = 0;
  for (const d of dupes) {
    const real = byLogin.get(d.login.toLowerCase())!;
    // A real user in this batch is being renamed, not replaced.
    if (d.id === real || incoming.has(d.id)) continue;
    await rekey(tx, "user", d.id, real);
    await tx.delete(ghUsers).where(eq(ghUsers.githubId, d.id));
    rekeyed += 1;
  }
  const bare = list.filter((u) => u.githubId !== u.login);
  const refs = await referenced(
    tx,
    "user",
    bare.map((u) => u.login),
  );
  for (const u of bare) {
    if (!refs.has(u.login)) continue;
    await rekey(tx, "user", u.login, u.githubId);
    rekeyed += 1;
  }

  const props = ["login", "avatarUrl"];
  const ret = await tx
    .insert(ghUsers)
    .values(list.map((u) => ({ githubId: u.githubId, login: u.login, avatarUrl: u.avatarUrl })))
    .onConflictDoUpdate({ target: ghUsers.githubId, set: excludedSet(ghUsers, props), setWhere: changed(ghUsers, props) })
    .returning({ inserted: insertedFlag });
  const stats = tallyUpsert(list.length, ret);
  stats.updated += rekeyed;
  return stats;
}

export async function upsertIssueTypes(tx: Tx, rows: FullSnapshot["issueTypes"]): Promise<StoreStats> {
  const list = lastByKey(rows, (t) => t.id);
  if (!list.length) return emptyStats();
  const props = ["name", "color", "description"];
  const ret = await tx
    .insert(issueTypes)
    .values(list)
    .onConflictDoUpdate({ target: issueTypes.id, set: excludedSet(issueTypes, props), setWhere: changed(issueTypes, props) })
    .returning({ inserted: insertedFlag });
  return tallyUpsert(list.length, ret);
}

/** Milestone IDs among `candidates` that issue or PR rows still reference. */
export async function referencedMilestones(tx: Tx, candidates: string[]): Promise<Set<string>> {
  if (!candidates.length) return new Set();
  const [a, b] = await Promise.all([
    tx.selectDistinct({ id: issues.milestoneId }).from(issues).where(inArray(issues.milestoneId, candidates)),
    tx.selectDistinct({ id: pullRequests.milestoneId }).from(pullRequests).where(inArray(pullRequests.milestoneId, candidates)),
  ]);
  return new Set([...a, ...b].map((r) => r.id).filter((id): id is string => id != null));
}

export async function upsertMilestones(tx: Tx, rows: FullSnapshot["milestones"]): Promise<StoreStats> {
  const list = lastByKey(rows, (m) => m.id);
  if (!list.length) return emptyStats();
  // IdResolver.milestoneId() hands out the provisional "ms:<number>" for a
  // milestone it hasn't seen; re-key those references to the real node ID now.
  let rekeyed = 0;
  const refs = await referencedMilestones(
    tx,
    list.map((m) => `ms:${m.number}`),
  );
  for (const m of list) {
    if (!refs.has(`ms:${m.number}`)) continue;
    await rekey(tx, "milestone", `ms:${m.number}`, m.id);
    rekeyed += 1;
  }
  const props = ["number", "title", "state", "dueOn"];
  const ret = await tx
    .insert(milestones)
    .values(list.map((m) => ({ id: m.id, number: m.number, title: m.title, state: m.state, dueOn: m.dueOn ? new Date(m.dueOn) : null })))
    .onConflictDoUpdate({ target: milestones.id, set: excludedSet(milestones, props), setWhere: changed(milestones, props) })
    .returning({ inserted: insertedFlag });
  const stats = tallyUpsert(list.length, ret);
  stats.updated += rekeyed;
  return stats;
}

/**
 * Fields with their options and iterations. A field counts as updated when
 * its row, an option or an iteration changed. Options and iterations GitHub
 * no longer lists are never deleted (S6): they get `missing_at`, and lose it
 * again if GitHub lists them once more.
 */
/**
 * Upsert project fields with their options and iterations. With `complete`
 * (the project's whole field list, as a full snapshot or the reconcile
 * carries it), a cached field missing from the list was deleted on GitHub: it
 * gets missing_at, never a delete, and comes back if GitHub lists it again.
 */
export async function upsertFields(tx: Tx, rows: { f: SnapshotField; position: number }[], projectId: string, complete = false): Promise<StoreStats> {
  const list = lastByKey(rows, (x) => x.f.id);
  if (!list.length) return emptyStats();
  const props = ["projectId", "name", "dataType", "position", "missingAt"];
  const ret = await tx
    .insert(projectFields)
    .values(list.map(({ f, position }) => ({ id: f.id, projectId, name: f.name, dataType: f.dataType, position, missingAt: null })))
    .onConflictDoUpdate({ target: projectFields.id, set: excludedSet(projectFields, props), setWhere: changed(projectFields, props) })
    .returning({ id: projectFields.id, inserted: insertedFlag });
  const result = new Map<string, Result>(ret.map((r) => [r.id, r.inserted ? "inserted" : "updated"]));
  const fieldIds = list.map((x) => x.f.id);

  // Options
  const optRows = lastByKey(
    list.flatMap(({ f }) => (f.options ?? []).map((o, i) => ({ id: o.id, fieldId: f.id, name: o.name, color: o.color, position: i, missingAt: null }))),
    (o) => o.id,
  );
  const optTouched = new Set<string>();
  if (optRows.length) {
    const p = ["fieldId", "name", "color", "position", "missingAt"];
    const changedOpts = await tx
      .insert(fieldOptions)
      .values(optRows)
      .onConflictDoUpdate({ target: fieldOptions.id, set: excludedSet(fieldOptions, p), setWhere: changed(fieldOptions, p) })
      .returning({ fieldId: fieldOptions.fieldId });
    for (const r of changedOpts) optTouched.add(r.fieldId);
  }
  const keepOpts = new Set(optRows.map((o) => o.id));
  const currentOpts = await tx
    .select({ id: fieldOptions.id, fieldId: fieldOptions.fieldId, missingAt: fieldOptions.missingAt })
    .from(fieldOptions)
    .where(inArray(fieldOptions.fieldId, fieldIds));
  const goneOpts = currentOpts.filter((o) => !keepOpts.has(o.id) && !o.missingAt);
  if (goneOpts.length) {
    await tx
      .update(fieldOptions)
      .set({ missingAt: new Date() })
      .where(
        inArray(
          fieldOptions.id,
          goneOpts.map((o) => o.id),
        ),
      );
    for (const o of goneOpts) optTouched.add(o.fieldId);
  }

  // Iterations
  const itRows = lastByKey(
    list.flatMap(({ f }) => (f.iterations ?? []).map((it) => ({ id: it.id, fieldId: f.id, title: it.title, startDate: it.startDate, durationDays: it.duration, missingAt: null }))),
    (it) => it.id,
  );
  if (itRows.length) {
    const p = ["fieldId", "title", "startDate", "durationDays", "missingAt"];
    const changedIts = await tx
      .insert(iterations)
      .values(itRows)
      .onConflictDoUpdate({ target: iterations.id, set: excludedSet(iterations, p), setWhere: changed(iterations, p) })
      .returning({ fieldId: iterations.fieldId });
    for (const r of changedIts) optTouched.add(r.fieldId);
  }
  const keepIts = new Set(itRows.map((i) => i.id));
  const currentIts = await tx
    .select({ id: iterations.id, fieldId: iterations.fieldId, missingAt: iterations.missingAt })
    .from(iterations)
    .where(inArray(iterations.fieldId, fieldIds));
  const goneIts = currentIts.filter((i) => !keepIts.has(i.id) && !i.missingAt);
  if (goneIts.length) {
    await tx
      .update(iterations)
      .set({ missingAt: new Date() })
      .where(
        inArray(
          iterations.id,
          goneIts.map((i) => i.id),
        ),
      );
    for (const i of goneIts) optTouched.add(i.fieldId);
  }

  const stats = emptyStats();
  for (const id of fieldIds) {
    const r = result.get(id) ?? (optTouched.has(id) ? "updated" : "unchanged");
    stats[r] += 1;
  }
  if (complete) {
    // Read first: an unchanged project writes nothing (S4).
    const gone = await tx
      .select({ id: projectFields.id })
      .from(projectFields)
      .where(and(notInArray(projectFields.id, fieldIds), isNull(projectFields.missingAt)));
    if (gone.length) {
      await tx.update(projectFields).set({ missingAt: new Date() }).where(inArray(projectFields.id, gone.map((g) => g.id)));
      stats.updated += gone.length;
    }
  }
  return stats;
}
