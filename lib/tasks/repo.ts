import { AsyncLocalStorage } from "node:async_hooks";
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { databaseUrl, getDb } from "@/db";
import {
  notifications as notificationsTable,
  taskComments,
  taskCompletions,
  taskLabelLinks,
  taskLabels,
  taskLinks,
  taskPlacements,
  taskProjects,
  taskReminders,
  tasks as tasksTable,
  userPrefs,
  users as usersTable,
} from "@/db/schema";
import { canSeeWithParent, type AppNotification, type TaskComment, type Prefs, type Priority, type Reminder, type TaskCore, type TaskLabel, type TaskLink, type TaskProject } from "./model";

/**
 * The transaction `locked()` opened, if this call runs inside one (S9), else
 * the shared client. Every query below goes through it, so the service's reads
 * and writes for one update share the transaction that holds the row lock.
 */
const txScope = new AsyncLocalStorage<ReturnType<typeof getDb>>();
function conn(): ReturnType<typeof getDb> {
  return txScope.getStore() ?? getDb();
}

/**
 * Task storage (SPEC §12). With DATABASE_URL tasks live in Postgres; without
 * one (demo fixtures, tests) in-memory maps are the store, as for views.
 *
 * Every task read takes the viewer and filters by visibility in the query
 * itself (§12.2), so no caller can forget to. Placements and labels are
 * per-user overlays and are always read for one login.
 */
export type StoredTask = TaskCore & { deletedAt: string | null };
export type Placement = { projectId: string | null; position: number };
export type StoredProject = TaskProject & { owner: string };
export type StoredLabel = TaskLabel & { owner: string };
export type NewNotification = Omit<AppNotification, "id" | "createdAt" | "readAt"> & { login: string; dedupeKey: string };

/** Completed tasks returned per list call; older ones stay in the DB. */
export const COMPLETED_LIMIT = 200;

export interface TaskRepo {
  listVisible(viewer: string): Promise<StoredTask[]>;
  getVisible(viewer: string, id: string): Promise<StoredTask | null>;
  /**
   * A soft-deleted task, for its creator only: the undo path. Retention
   * hard-deletes it after RETENTION_DELETED_DAYS (S8).
   */
  getDeletedByCreator(viewer: string, id: string): Promise<StoredTask | null>;
  /** Visible sub-tasks of a task. */
  children(viewer: string, parentId: string): Promise<StoredTask[]>;
  insert(t: StoredTask): Promise<void>;
  update(id: string, patch: Partial<StoredTask>): Promise<void>;

  placements(login: string): Promise<Map<string, Placement>>;
  setPlacement(taskId: string, login: string, p: Placement): Promise<void>;
  /** Highest position the login uses in a project (null = Inbox). */
  maxPosition(login: string, projectId: string | null): Promise<number>;

  labelLinks(login: string): Promise<Map<string, string[]>>;
  /** Replace the login's labels on a task; other users' labels are untouched. */
  setLabelLinks(taskId: string, login: string, labelIds: string[]): Promise<void>;

  projects(login: string): Promise<StoredProject[]>;
  /** False when the owner already has a project with this name (case-insensitive). */
  insertProject(p: StoredProject): Promise<boolean>;
  updateProject(id: string, patch: Partial<StoredProject>): Promise<void>;

  labels(login: string): Promise<StoredLabel[]>;
  /** False when the owner already has a label with this name (case-insensitive). */
  insertLabel(l: StoredLabel): Promise<boolean>;
  updateLabel(id: string, patch: Partial<StoredLabel>): Promise<void>;
  deleteLabel(id: string): Promise<void>;

  /**
   * Log a completed occurrence. False when that occurrence (task, due date)
   * was already logged: the caller must not move the due date again (S9).
   */
  addCompletion(taskId: string, login: string, dueDate: string | null): Promise<boolean>;
  /**
   * Run `fn` holding the task's row lock: Postgres opens one transaction with
   * SELECT … FOR UPDATE and runs every repo call in `fn` inside it, so two
   * concurrent updates of one task apply one after the other. The in-memory
   * repo just runs `fn`.
   *
   * A refused result (`{ ok: false }`, or `{ result: { ok: false } }`) rolls the
   * transaction back and is still returned: a refusal must leave nothing
   * written, even when it was decided after a write (v5 1.7).
   */
  locked<T>(id: string, fn: () => Promise<T>): Promise<T>;

  comments(taskId: string): Promise<TaskComment[]>;
  comment(taskId: string, id: string): Promise<TaskComment | null>;
  insertComment(c: TaskComment): Promise<void>;
  updateComment(id: string, body: string): Promise<void>;
  deleteComment(id: string): Promise<void>;
  /** Soft-delete a task's comments with the task's own deletion time, so an undo can find them (U1). */
  deleteCommentsForTask(taskId: string, at?: string): Promise<void>;
  /**
   * Undo a task delete (U1): the task, and the sub-tasks and comments deleted
   * with it (same `deletedAt`), come back.
   */
  restoreTask(id: string, deletedAt: string): Promise<void>;
  /** Undo a logged occurrence; true when there was one to remove (U1). */
  removeCompletion(taskId: string, dueDate: string): Promise<boolean>;

  /**
   * Open tasks that may have a reminder due around now, for every user: due
   * between the two dates, or with an absolute reminder in (since, until].
   */
  /** Tasks that may have a reminder due. With `login`, only those that notify that person (v5 3.1). */
  reminderCandidates(fromDate: string, toDate: string, since: Date, until: Date, login?: string): Promise<StoredTask[]>;

  /** Insert unless the dedupe key exists; true when inserted. */
  addNotification(n: NewNotification): Promise<boolean>;
  notifications(login: string, limit: number): Promise<{ list: AppNotification[]; unread: number }>;
  markRead(login: string, ids: string[] | "all"): Promise<void>;
  deleteNotificationsForTask(taskId: string): Promise<void>;

  prefs(login: string): Promise<Prefs>;
  setPrefs(login: string, p: Partial<Prefs>): Promise<Prefs>;

  /** Lowercase logins with a Deska account (signed in at least once). */
  signedInLogins(): Promise<Set<string>>;
  /** Record a login as signed in (memory repo only; Postgres has `users`). */
  noteSignedIn(login: string): void;
}

const DEFAULT_PREFS: Prefs = { tz: null, browserNotifications: false, sidebar: null, defaultTeam: null };

function capCompleted<T extends { completedAt: string | null }>(list: T[]): T[] {
  const open = list.filter((t) => !t.completedAt);
  const done = list
    .filter((t) => t.completedAt)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, COMPLETED_LIMIT);
  return [...open, ...done];
}

const copy = (t: StoredTask): StoredTask => ({ ...t, links: [...t.links], reminders: t.reminders.map((r) => ({ ...r })) });

export class MemoryTaskRepo implements TaskRepo {
  map = new Map<string, StoredTask>();
  place = new Map<string, Placement>(); // `${taskId}|${login}`
  projectMap = new Map<string, StoredProject>();
  labelMap = new Map<string, StoredLabel>();
  labelLinkSet = new Set<string>(); // `${taskId}|${labelId}`
  completions: { taskId: string; login: string; dueDate: string | null; at: string }[] = [];
  commentList: (TaskComment & { deleted: boolean; deletedAt?: string })[] = [];
  notes: (AppNotification & { login: string; dedupeKey: string })[] = [];
  prefMap = new Map<string, Prefs>();
  seen = new Set<string>();

  private visible(t: StoredTask | undefined, viewer: string): t is StoredTask {
    if (!t || t.deletedAt) return false;
    const parent = t.parentId ? this.map.get(t.parentId) : null;
    return canSeeWithParent(t, parent && !parent.deletedAt ? parent : null, viewer);
  }
  async listVisible(viewer: string) {
    return capCompleted([...this.map.values()].filter((t) => this.visible(t, viewer)).map(copy));
  }
  async getVisible(viewer: string, id: string) {
    const t = this.map.get(id);
    return this.visible(t, viewer) ? copy(t) : null;
  }
  async getDeletedByCreator(viewer: string, id: string) {
    const t = this.map.get(id);
    return t?.deletedAt && t.creator === viewer ? copy(t) : null;
  }
  async children(viewer: string, parentId: string) {
    return [...this.map.values()].filter((t) => t.parentId === parentId && this.visible(t, viewer)).map(copy);
  }
  async insert(t: StoredTask) {
    this.map.set(t.id, copy(t));
  }
  async update(id: string, patch: Partial<StoredTask>) {
    const t = this.map.get(id);
    if (t) this.map.set(id, { ...t, ...patch });
  }
  async placements(login: string) {
    const out = new Map<string, Placement>();
    for (const [k, p] of this.place) {
      const [taskId, l] = k.split("|");
      if (l === login && taskId) out.set(taskId, { ...p });
    }
    return out;
  }
  async setPlacement(taskId: string, login: string, p: Placement) {
    this.place.set(`${taskId}|${login}`, { ...p });
  }
  async maxPosition(login: string, projectId: string | null) {
    // Like SQL max(): 0 only when the list is empty, so positions dragged below 0 count.
    let max: number | null = null;
    for (const [k, p] of this.place) if (k.endsWith(`|${login}`) && p.projectId === projectId) max = Math.max(max ?? p.position, p.position);
    return max ?? 0;
  }
  async labelLinks(login: string) {
    const out = new Map<string, string[]>();
    for (const k of this.labelLinkSet) {
      const [taskId, labelId] = k.split("|");
      if (!taskId || !labelId || this.labelMap.get(labelId)?.owner !== login) continue;
      out.set(taskId, [...(out.get(taskId) ?? []), labelId]);
    }
    return out;
  }
  async setLabelLinks(taskId: string, login: string, labelIds: string[]) {
    for (const k of [...this.labelLinkSet]) {
      const [t, l] = k.split("|");
      if (t === taskId && l && this.labelMap.get(l)?.owner === login) this.labelLinkSet.delete(k);
    }
    for (const id of labelIds) this.labelLinkSet.add(`${taskId}|${id}`);
  }
  async projects(login: string) {
    return [...this.projectMap.values()].filter((p) => p.owner === login).map((p) => ({ ...p }));
  }
  async insertProject(p: StoredProject) {
    // Mirrors the (owner, lower(name)) unique index.
    const name = p.name.toLowerCase();
    for (const x of this.projectMap.values()) if (x.owner === p.owner && x.name.toLowerCase() === name) return false;
    this.projectMap.set(p.id, { ...p });
    return true;
  }
  async updateProject(id: string, patch: Partial<StoredProject>) {
    const p = this.projectMap.get(id);
    if (p) this.projectMap.set(id, { ...p, ...patch });
  }
  async labels(login: string) {
    return [...this.labelMap.values()].filter((l) => l.owner === login).map((l) => ({ ...l }));
  }
  async insertLabel(l: StoredLabel) {
    // Mirrors the (owner, lower(name)) unique index: a duplicate name is ignored.
    const name = l.name.toLowerCase();
    for (const x of this.labelMap.values()) if (x.owner === l.owner && x.name.toLowerCase() === name) return false;
    this.labelMap.set(l.id, { ...l });
    return true;
  }
  async updateLabel(id: string, patch: Partial<StoredLabel>) {
    const l = this.labelMap.get(id);
    if (l) this.labelMap.set(id, { ...l, ...patch });
  }
  async deleteLabel(id: string) {
    this.labelMap.delete(id);
    for (const k of [...this.labelLinkSet]) if (k.endsWith(`|${id}`)) this.labelLinkSet.delete(k);
  }
  async addCompletion(taskId: string, login: string, dueDate: string | null) {
    if (dueDate && this.completions.some((c) => c.taskId === taskId && c.dueDate === dueDate)) return false;
    this.completions.push({ taskId, login, dueDate, at: new Date().toISOString() });
    return true;
  }
  async locked<T>(_id: string, fn: () => Promise<T>) {
    return fn();
  }
  async comments(taskId: string) {
    return this.commentList
      .filter((c) => c.taskId === taskId && !c.deleted)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(({ deleted: _d, ...c }) => c);
  }
  async comment(taskId: string, id: string) {
    const c = this.commentList.find((x) => x.id === id && x.taskId === taskId && !x.deleted);
    if (!c) return null;
    const { deleted: _d, ...out } = c;
    return out;
  }
  async insertComment(c: TaskComment) {
    this.commentList.push({ ...c, deleted: false });
  }
  async updateComment(id: string, body: string) {
    const c = this.commentList.find((x) => x.id === id);
    if (c) Object.assign(c, { body, updatedAt: new Date().toISOString() });
  }
  async deleteComment(id: string) {
    const c = this.commentList.find((x) => x.id === id);
    if (c) c.deleted = true;
  }
  async deleteCommentsForTask(taskId: string, at = new Date().toISOString()) {
    for (const c of this.commentList) {
      if (c.taskId !== taskId || c.deleted) continue;
      c.deleted = true;
      c.deletedAt = at;
    }
  }
  async restoreTask(id: string, deletedAt: string) {
    const ids = new Set<string>();
    for (const t of this.map.values()) {
      if ((t.id === id || t.parentId === id) && t.deletedAt === deletedAt) {
        this.map.set(t.id, { ...t, deletedAt: null });
        ids.add(t.id);
      }
    }
    for (const c of this.commentList) {
      if (ids.has(c.taskId) && c.deleted && c.deletedAt === deletedAt) {
        c.deleted = false;
        delete c.deletedAt;
      }
    }
  }
  async removeCompletion(taskId: string, dueDate: string) {
    const i = this.completions.findIndex((c) => c.taskId === taskId && c.dueDate === dueDate);
    if (i < 0) return false;
    this.completions.splice(i, 1);
    return true;
  }
  async reminderCandidates(fromDate: string, toDate: string, since: Date, until: Date, login?: string) {
    return [...this.map.values()]
      .filter(
        (t) =>
          (!login || (t.assignee ?? t.creator) === login) &&
          !t.deletedAt &&
          !t.completedAt &&
          ((t.dueDate != null && t.dueDate >= fromDate && t.dueDate <= toDate) ||
            t.reminders.some((r) => r.kind === "absolute" && Date.parse(r.at) > since.getTime() && Date.parse(r.at) <= until.getTime())),
      )
      .map(copy);
  }
  async addNotification(n: NewNotification) {
    if (this.notes.some((x) => x.dedupeKey === n.dedupeKey)) return false;
    this.notes.push({ ...n, id: crypto.randomUUID(), createdAt: new Date().toISOString(), readAt: null });
    return true;
  }
  async notifications(login: string, limit: number) {
    // Only notifications for tasks the viewer can still open (reassigned or deleted ones drop out).
    const mine = this.notes
      .filter((n) => n.login === login && (n.taskId === null || this.visible(this.map.get(n.taskId), login)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      list: mine.slice(0, limit).map(({ login: _l, dedupeKey: _d, ...n }) => n),
      unread: mine.filter((n) => !n.readAt).length,
    };
  }
  async markRead(login: string, ids: string[] | "all") {
    const now = new Date().toISOString();
    for (const n of this.notes) if (n.login === login && !n.readAt && (ids === "all" || ids.includes(n.id))) n.readAt = now;
  }
  async deleteNotificationsForTask(taskId: string) {
    this.notes = this.notes.filter((n) => n.taskId !== taskId);
  }
  async prefs(login: string) {
    return { ...(this.prefMap.get(login) ?? DEFAULT_PREFS) };
  }
  async setPrefs(login: string, p: Partial<Prefs>) {
    const next = { ...(this.prefMap.get(login) ?? DEFAULT_PREFS), ...p };
    this.prefMap.set(login, next);
    return { ...next };
  }
  async signedInLogins() {
    return new Set(this.seen);
  }
  noteSignedIn(login: string) {
    this.seen.add(login.toLowerCase());
  }
}

type Row = typeof tasksTable.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function fromRow(r: Row, links: TaskLink[] = [], reminders: Reminder[] = []): StoredTask {
  return {
    id: r.id,
    creator: r.creatorLogin,
    assignee: r.assigneeLogin,
    parentId: r.parentId,
    title: r.title,
    description: r.description,
    priority: r.priority as Priority,
    dueDate: r.dueDate,
    dueTime: r.dueTime,
    dueTz: r.dueTz,
    recurrence: r.recurrenceRule ? { rule: r.recurrenceRule, text: r.recurrenceText ?? "", fromCompletion: r.recurrenceFromCompletion } : null,
    reminders,
    completedAt: iso(r.completedAt),
    completedBy: r.completedBy,
    links,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: iso(r.deletedAt),
  };
}

function toRow(p: Partial<StoredTask>): Partial<Row> {
  const out: Partial<Row> = {};
  if (p.creator !== undefined) out.creatorLogin = p.creator;
  if (p.assignee !== undefined) out.assigneeLogin = p.assignee;
  if (p.parentId !== undefined) out.parentId = p.parentId;
  if (p.title !== undefined) out.title = p.title;
  if (p.description !== undefined) out.description = p.description;
  if (p.priority !== undefined) out.priority = p.priority;
  if (p.dueDate !== undefined) out.dueDate = p.dueDate;
  if (p.dueTime !== undefined) out.dueTime = p.dueTime;
  if (p.dueTz !== undefined) out.dueTz = p.dueTz;
  if (p.recurrence !== undefined) {
    out.recurrenceRule = p.recurrence?.rule ?? null;
    out.recurrenceText = p.recurrence?.text ?? null;
    out.recurrenceFromCompletion = p.recurrence?.fromCompletion ?? false;
  }
  if (p.completedAt !== undefined) out.completedAt = p.completedAt ? new Date(p.completedAt) : null;
  if (p.completedBy !== undefined) out.completedBy = p.completedBy;
  if (p.createdAt !== undefined) out.createdAt = new Date(p.createdAt);
  if (p.updatedAt !== undefined) out.updatedAt = new Date(p.updatedAt);
  if (p.deletedAt !== undefined) out.deletedAt = p.deletedAt ? new Date(p.deletedAt) : null;
  return out;
}

async function linksFor(ids: string[]): Promise<Map<string, TaskLink[]>> {
  const out = new Map<string, TaskLink[]>();
  if (!ids.length) return out;
  const rows = await conn().select().from(taskLinks).where(inArray(taskLinks.taskId, ids)).orderBy(asc(taskLinks.position));
  for (const r of rows) {
    const list = out.get(r.taskId) ?? [];
    list.push({ kind: r.targetKind === "pr" ? "pr" : "issue", nodeId: r.targetNodeId, number: r.targetNumber });
    out.set(r.taskId, list);
  }
  return out;
}

/** The client or an open transaction: a task row and its child rows are written together. */
type Db = Pick<ReturnType<typeof getDb>, "insert" | "update" | "delete">;

async function writeLinks(db: Db, taskId: string, links: TaskLink[]) {
  await db.delete(taskLinks).where(eq(taskLinks.taskId, taskId));
  if (links.length) {
    await db.insert(taskLinks).values(
      links.map((l, i) => ({ taskId, targetKind: l.kind, targetNodeId: l.nodeId, targetNumber: l.number, position: i })),
    );
  }
}

async function remindersFor(ids: string[]): Promise<Map<string, Reminder[]>> {
  const out = new Map<string, Reminder[]>();
  if (!ids.length) return out;
  const rows = await conn().select().from(taskReminders).where(inArray(taskReminders.taskId, ids));
  for (const r of rows) {
    const rem: Reminder | null =
      r.kind === "absolute" && r.at ? { id: r.id, kind: "absolute", at: r.at.toISOString() } : r.kind === "relative" ? { id: r.id, kind: "relative", offsetMin: r.offsetMin ?? 0 } : null;
    if (rem) out.set(r.taskId, [...(out.get(r.taskId) ?? []), rem]);
  }
  return out;
}

async function writeReminders(db: Db, taskId: string, reminders: Reminder[]) {
  await db.delete(taskReminders).where(eq(taskReminders.taskId, taskId));
  if (reminders.length) {
    await db.insert(taskReminders).values(
      reminders.map((r) =>
        r.kind === "absolute"
          ? { id: r.id, taskId, kind: "absolute", at: new Date(r.at), offsetMin: null }
          : { id: r.id, taskId, kind: "relative", offsetMin: r.offsetMin, at: null },
      ),
    );
  }
}

/** Internal: carries a refused result out of a transaction that is being rolled back. */
class Refused {
  constructor(readonly result: unknown) {}
}

function isRefusal(out: unknown): boolean {
  const o = out as { ok?: unknown; result?: { ok?: unknown } } | null;
  return o?.ok === false || o?.result?.ok === false;
}

/**
 * Run queries together, or one after another inside a `locked()` transaction:
 * its single client must not get concurrent queries (pg 8.23 warns, pg 9 drops
 * them; v5 2.12).
 */
async function together<const T extends readonly (() => Promise<unknown>)[]>(fns: T): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  if (!txScope.getStore()) return (await Promise.all(fns.map((f) => f()))) as never;
  const out: unknown[] = [];
  for (const f of fns) out.push(await f());
  return out as never;
}

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class PostgresTaskRepo implements TaskRepo {
  /** Direct visibility, or visibility through the parent (one level). */
  private visible(viewer: string) {
    const v = viewer.toLowerCase();
    const direct = or(eq(tasksTable.creatorLogin, v), eq(tasksTable.assigneeLogin, v));
    const viaParent = sql`${tasksTable.parentId} in (select p.id from tasks p where p.deleted_at is null and (p.creator_login = ${v} or p.assignee_login = ${v}))`;
    return and(isNull(tasksTable.deletedAt), or(direct, viaParent));
  }
  private async withLinks(rows: Row[]) {
    const ids = rows.map((r) => r.id);
    const [links, reminders] = await together([() => linksFor(ids), () => remindersFor(ids)]);
    return rows.map((r) => fromRow(r, links.get(r.id), reminders.get(r.id)));
  }
  async listVisible(viewer: string) {
    const db = conn();
    const [open, done] = await together([
      () => db.select().from(tasksTable).where(and(this.visible(viewer), isNull(tasksTable.completedAt))),
      () =>
        db
          .select()
          .from(tasksTable)
          .where(and(this.visible(viewer), isNotNull(tasksTable.completedAt)))
          .orderBy(desc(tasksTable.completedAt))
          .limit(COMPLETED_LIMIT),
    ]);
    return this.withLinks([...open, ...done]);
  }
  async getVisible(viewer: string, id: string) {
    // Malformed IDs would make Postgres throw on the uuid cast; treat as absent.
    if (!isUuid(id)) return null;
    const rows = await conn()
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.id, id), this.visible(viewer)))
      .limit(1);
    return rows[0] ? (await this.withLinks(rows))[0]! : null;
  }
  async getDeletedByCreator(viewer: string, id: string) {
    if (!isUuid(id)) return null;
    const rows = await conn()
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.id, id), isNotNull(tasksTable.deletedAt), eq(tasksTable.creatorLogin, viewer)))
      .limit(1);
    return rows[0] ? (await this.withLinks(rows))[0]! : null;
  }
  async children(viewer: string, parentId: string) {
    if (!isUuid(parentId)) return [];
    const rows = await conn()
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.parentId, parentId), this.visible(viewer)));
    return this.withLinks(rows);
  }
  async insert(t: StoredTask) {
    await conn().transaction(async (tx) => {
      await tx.insert(tasksTable).values({ id: t.id, ...toRow(t) } as Row);
      await writeLinks(tx, t.id, t.links);
      await writeReminders(tx, t.id, t.reminders);
    });
  }
  async update(id: string, patch: Partial<StoredTask>) {
    const set = toRow(patch);
    await conn().transaction(async (tx) => {
      if (Object.keys(set).length) await tx.update(tasksTable).set(set).where(eq(tasksTable.id, id));
      if (patch.links) await writeLinks(tx, id, patch.links);
      if (patch.reminders) await writeReminders(tx, id, patch.reminders);
    });
  }
  async placements(login: string) {
    const rows = await conn().select().from(taskPlacements).where(eq(taskPlacements.login, login));
    return new Map(rows.map((r) => [r.taskId, { projectId: r.projectId, position: r.position }]));
  }
  async setPlacement(taskId: string, login: string, p: Placement) {
    await conn()
      .insert(taskPlacements)
      .values({ taskId, login, projectId: p.projectId, position: p.position })
      .onConflictDoUpdate({ target: [taskPlacements.taskId, taskPlacements.login], set: { projectId: p.projectId, position: p.position } });
  }
  async maxPosition(login: string, projectId: string | null) {
    const rows = await conn()
      .select({ max: sql<number | null>`max(${taskPlacements.position})` })
      .from(taskPlacements)
      .where(and(eq(taskPlacements.login, login), projectId ? eq(taskPlacements.projectId, projectId) : isNull(taskPlacements.projectId)));
    return Number(rows[0]?.max ?? 0);
  }
  async labelLinks(login: string) {
    const rows = await conn()
      .select({ taskId: taskLabelLinks.taskId, labelId: taskLabelLinks.labelId })
      .from(taskLabelLinks)
      .innerJoin(taskLabels, eq(taskLabels.id, taskLabelLinks.labelId))
      .where(eq(taskLabels.ownerLogin, login));
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.taskId, [...(out.get(r.taskId) ?? []), r.labelId]);
    return out;
  }
  async setLabelLinks(taskId: string, login: string, labelIds: string[]) {
    const db = conn();
    await db
      .delete(taskLabelLinks)
      .where(
        and(
          eq(taskLabelLinks.taskId, taskId),
          inArray(taskLabelLinks.labelId, db.select({ id: taskLabels.id }).from(taskLabels).where(eq(taskLabels.ownerLogin, login))),
        ),
      );
    if (labelIds.length) await db.insert(taskLabelLinks).values(labelIds.map((labelId) => ({ taskId, labelId }))).onConflictDoNothing();
  }
  async projects(login: string) {
    const rows = await conn().select().from(taskProjects).where(eq(taskProjects.ownerLogin, login));
    return rows.map((r) => ({ id: r.id, owner: r.ownerLogin, name: r.name, color: r.color, position: r.position, archived: r.archivedAt != null, source: r.source ?? null }));
  }
  async insertProject(p: StoredProject) {
    const rows = await conn()
      .insert(taskProjects)
      .values({ id: p.id, ownerLogin: p.owner, name: p.name, color: p.color, position: p.position, archivedAt: p.archived ? new Date() : null, source: p.source })
      .onConflictDoNothing()
      .returning({ id: taskProjects.id });
    return rows.length > 0;
  }
  async updateProject(id: string, patch: Partial<StoredProject>) {
    const set: Partial<typeof taskProjects.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.color !== undefined) set.color = patch.color;
    if (patch.position !== undefined) set.position = patch.position;
    if (patch.archived !== undefined) set.archivedAt = patch.archived ? new Date() : null;
    if (patch.source !== undefined) set.source = patch.source;
    if (Object.keys(set).length) await conn().update(taskProjects).set(set).where(eq(taskProjects.id, id));
  }
  async labels(login: string) {
    const rows = await conn().select().from(taskLabels).where(eq(taskLabels.ownerLogin, login));
    return rows.map((r) => ({ id: r.id, owner: r.ownerLogin, name: r.name, color: r.color }));
  }
  async insertLabel(l: StoredLabel) {
    const rows = await conn()
      .insert(taskLabels)
      .values({ id: l.id, ownerLogin: l.owner, name: l.name, color: l.color })
      .onConflictDoNothing()
      .returning({ id: taskLabels.id });
    return rows.length > 0;
  }
  async updateLabel(id: string, patch: Partial<StoredLabel>) {
    const set: Partial<typeof taskLabels.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.color !== undefined) set.color = patch.color;
    if (Object.keys(set).length) await conn().update(taskLabels).set(set).where(eq(taskLabels.id, id));
  }
  async deleteLabel(id: string) {
    const db = conn();
    await db.delete(taskLabelLinks).where(eq(taskLabelLinks.labelId, id));
    await db.delete(taskLabels).where(eq(taskLabels.id, id));
  }
  async addCompletion(taskId: string, login: string, dueDate: string | null) {
    const rows = await conn().insert(taskCompletions).values({ taskId, login, dueDate }).onConflictDoNothing().returning({ id: taskCompletions.id });
    return rows.length > 0;
  }
  async locked<T>(id: string, fn: () => Promise<T>) {
    // Already inside a locked call: same transaction.
    if (txScope.getStore()) return fn();
    try {
      return await getDb().transaction(async (tx) => {
        if (isUuid(id)) await tx.execute(sql`SELECT id FROM tasks WHERE id = ${id} FOR UPDATE`);
        const out = await txScope.run(tx as unknown as ReturnType<typeof getDb>, fn);
        // Throwing is how a Drizzle transaction rolls back; the sentinel carries
        // the result out so the caller still gets its 400/403/409.
        if (isRefusal(out)) throw new Refused(out);
        return out;
      });
    } catch (e) {
      if (e instanceof Refused) return e.result as T;
      throw e;
    }
  }
  private toComment(r: typeof taskComments.$inferSelect): TaskComment {
    return { id: r.id, taskId: r.taskId, author: r.authorLogin, body: r.body, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
  }
  async comments(taskId: string) {
    if (!isUuid(taskId)) return [];
    const rows = await conn()
      .select()
      .from(taskComments)
      .where(and(eq(taskComments.taskId, taskId), isNull(taskComments.deletedAt)))
      .orderBy(asc(taskComments.createdAt));
    return rows.map((r) => this.toComment(r));
  }
  async comment(taskId: string, id: string) {
    if (!isUuid(taskId) || !isUuid(id)) return null;
    const rows = await conn()
      .select()
      .from(taskComments)
      .where(and(eq(taskComments.id, id), eq(taskComments.taskId, taskId), isNull(taskComments.deletedAt)))
      .limit(1);
    return rows[0] ? this.toComment(rows[0]) : null;
  }
  async insertComment(c: TaskComment) {
    await conn()
      .insert(taskComments)
      .values({ id: c.id, taskId: c.taskId, authorLogin: c.author, body: c.body, createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) });
  }
  async updateComment(id: string, body: string) {
    await conn().update(taskComments).set({ body, updatedAt: new Date() }).where(eq(taskComments.id, id));
  }
  async deleteComment(id: string) {
    await conn().update(taskComments).set({ deletedAt: new Date() }).where(eq(taskComments.id, id));
  }
  async deleteCommentsForTask(taskId: string, at?: string) {
    await conn()
      .update(taskComments)
      .set({ deletedAt: at ? new Date(at) : new Date() })
      .where(and(eq(taskComments.taskId, taskId), isNull(taskComments.deletedAt)));
  }
  async restoreTask(id: string, deletedAt: string) {
    if (!isUuid(id)) return;
    const at = new Date(deletedAt);
    await conn().transaction(async (tx) => {
      const back = await tx
        .update(tasksTable)
        .set({ deletedAt: null })
        .where(and(or(eq(tasksTable.id, id), eq(tasksTable.parentId, id)), eq(tasksTable.deletedAt, at)))
        .returning({ id: tasksTable.id });
      if (back.length) {
        await tx
          .update(taskComments)
          .set({ deletedAt: null })
          .where(
            and(
              inArray(
                taskComments.taskId,
                back.map((r) => r.id),
              ),
              eq(taskComments.deletedAt, at),
            ),
          );
      }
    });
  }
  async removeCompletion(taskId: string, dueDate: string) {
    if (!isUuid(taskId)) return false;
    const gone = await conn()
      .delete(taskCompletions)
      .where(and(eq(taskCompletions.taskId, taskId), eq(taskCompletions.dueDate, dueDate)))
      .returning({ id: taskCompletions.id });
    return gone.length > 0;
  }
  async reminderCandidates(fromDate: string, toDate: string, since: Date, until: Date, login?: string) {
    const absolute = conn()
      .select({ id: taskReminders.taskId })
      .from(taskReminders)
      .where(and(eq(taskReminders.kind, "absolute"), gt(taskReminders.at, since), lte(taskReminders.at, until)));
    const rows = await conn()
      .select()
      .from(tasksTable)
      .where(
        and(
          isNull(tasksTable.deletedAt),
          isNull(tasksTable.completedAt),
          // The 30 s notifications poll asks for one person: filter in SQL, not in JS over everyone's tasks.
          login ? sql`coalesce(${tasksTable.assigneeLogin}, ${tasksTable.creatorLogin}) = ${login}` : undefined,
          or(and(gte(tasksTable.dueDate, fromDate), lte(tasksTable.dueDate, toDate)), inArray(tasksTable.id, absolute)),
        ),
      );
    return this.withLinks(rows);
  }
  async addNotification(n: NewNotification) {
    const rows = await conn()
      .insert(notificationsTable)
      .values({ login: n.login, kind: n.kind, taskId: n.taskId, actorLogin: n.actor, title: n.title, dedupeKey: n.dedupeKey })
      .onConflictDoNothing({ target: notificationsTable.dedupeKey })
      .returning({ id: notificationsTable.id });
    return rows.length > 0;
  }
  async notifications(login: string, limit: number) {
    const db = conn();
    // Only notifications for tasks the viewer can still open (reassigned or deleted ones drop out).
    // A digest has no task: it is always the viewer's own to see.
    const mine = and(eq(notificationsTable.login, login), or(isNull(notificationsTable.taskId), this.visible(login)));
    const [rows, unread] = await Promise.all([
      db
        .select({ n: notificationsTable })
        .from(notificationsTable)
        .leftJoin(tasksTable, eq(tasksTable.id, notificationsTable.taskId))
        .where(mine)
        .orderBy(desc(notificationsTable.createdAt))
        .limit(limit),
      db
        .select({ n: count() })
        .from(notificationsTable)
        .leftJoin(tasksTable, eq(tasksTable.id, notificationsTable.taskId))
        .where(and(mine, isNull(notificationsTable.readAt))),
    ]);
    return {
      list: rows.map(({ n: r }) => ({
        id: r.id,
        kind: r.kind as AppNotification["kind"],
        taskId: r.taskId,
        actor: r.actorLogin,
        title: r.title,
        createdAt: r.createdAt.toISOString(),
        readAt: iso(r.readAt),
      })),
      unread: Number(unread[0]?.n ?? 0),
    };
  }
  async markRead(login: string, ids: string[] | "all") {
    const scope = ids === "all" ? undefined : inArray(notificationsTable.id, ids.filter(isUuid));
    if (ids !== "all" && !ids.some(isUuid)) return;
    await conn()
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(and(eq(notificationsTable.login, login), isNull(notificationsTable.readAt), scope));
  }
  async deleteNotificationsForTask(taskId: string) {
    await conn().delete(notificationsTable).where(eq(notificationsTable.taskId, taskId));
  }
  async prefs(login: string) {
    const rows = await conn().select().from(userPrefs).where(eq(userPrefs.login, login)).limit(1);
    return rows[0] ? { tz: rows[0].tz, browserNotifications: rows[0].browserNotifications, sidebar: rows[0].sidebar ?? null, defaultTeam: rows[0].defaultTeam ?? null } : { ...DEFAULT_PREFS };
  }
  async setPrefs(login: string, p: Partial<Prefs>) {
    const next = { ...(await this.prefs(login)), ...p };
    await conn()
      .insert(userPrefs)
      .values({ login, tz: next.tz, browserNotifications: next.browserNotifications, sidebar: next.sidebar, defaultTeam: next.defaultTeam })
      .onConflictDoUpdate({ target: userPrefs.login, set: { tz: next.tz, browserNotifications: next.browserNotifications, sidebar: next.sidebar, defaultTeam: next.defaultTeam } });
    return next;
  }
  async signedInLogins() {
    const rows = await conn()
      .select({ login: sql<string>`lower(${usersTable.login})` })
      .from(usersTable);
    return new Set(rows.map((r) => r.login));
  }
  noteSignedIn() {
    /* sign-in writes the users row (lib/auth.ts) */
  }
}

// On globalThis, not module scope: Next bundles each route separately in dev,
// so a module-level Map gave /api/tasks and /api/tasks/[id] different stores.
// Each route bundle has its own copy of the class, so `instanceof` can't tell
// a usable store apart; check its shape. A hot reload that adds a method
// starts a fresh store (dev only).
const g = globalThis as { __deskaTasks?: Record<string, unknown> };
const methods = Object.getOwnPropertyNames(MemoryTaskRepo.prototype);
if (!g.__deskaTasks || !methods.every((m) => typeof g.__deskaTasks![m] === "function")) {
  g.__deskaTasks = new MemoryTaskRepo() as unknown as Record<string, unknown>;
}
const memory = g.__deskaTasks as unknown as MemoryTaskRepo;

export function taskRepo(): TaskRepo {
  return databaseUrl() ? new PostgresTaskRepo() : memory;
}

/** Test helper: reset the in-memory task store. */
export function __resetTasks(): void {
  memory.map.clear();
  memory.place.clear();
  memory.projectMap.clear();
  memory.labelMap.clear();
  memory.labelLinkSet.clear();
  memory.completions = [];
  memory.commentList = [];
  memory.notes = [];
  memory.prefMap.clear();
  memory.seen.clear();
}
