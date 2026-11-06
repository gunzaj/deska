import { randomUUID } from "node:crypto";
import { canSignIn } from "../allowlist";
import { daysBetween, localToday, shiftInstant } from "./dates";
import {
  canDelete,
  canEdit,
  normLogin,
  type Access,
  type AppNotification,
  type CreateTaskInput,
  type PatchTaskInput,
  type Prefs,
  type ProjectSource,
  type Reminder,
  type ReminderInput,
  type Task,
  type TaskComment,
  type TaskLabel,
  type TaskLink,
  type TaskProject,
} from "./model";
import { fireWatchDigest } from "../watch/digest";
import { fireReminders, notifyEvent } from "./notify";
import { nextOccurrence, pinMonthDay } from "./recurrence";
import { taskRepo, type Placement, type StoredTask, type TaskRepo } from "./repo";

/**
 * Task operations for the API (SPEC §12). Nothing here calls GitHub or depends
 * on WRITE_MODE: tasks are Deska-native data.
 *
 * A task the viewer cannot see is reported as `not_found`, never `forbidden`,
 * so the API does not reveal that it exists (§12.2).
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; error: string }
  /** The task changed since the client's `expectedUpdatedAt` (S9). */
  | { ok: false; status: 409; error: string; current: Task }
  /** A unique name was taken between the check and the insert. */
  | { ok: false; status: 409; error: string; current?: undefined };

/** Who may be assigned: a known GitHub user (gh_users) or the viewer. */
export type Assignable = (login: string) => boolean;

/** Look up an issue or PR in the cache by number. */
export type Resolve = (n: number) => (TaskLink & { title: string }) | null;

const noResolve: Resolve = () => null;
const bad = (error: string) => ({ ok: false, status: 400, error }) as const;
const notFound = { ok: false, status: 404, error: "task not found" } as const;

/**
 * Turn requested numbers into links. Numbers already linked keep their stored
 * link even if the item has since left the cache; new ones must resolve.
 */
function resolveLinks(numbers: number[], resolve: Resolve, existing: TaskLink[] = []): { links: TaskLink[]; missing: number[] } {
  const links: TaskLink[] = [];
  const missing: number[] = [];
  for (const n of [...new Set(numbers)]) {
    const kept = existing.find((l) => l.number === n);
    const r = kept ?? resolve(n);
    if (!r) missing.push(n);
    else links.push({ kind: r.kind, nodeId: r.nodeId, number: r.number });
  }
  return { links, missing };
}

/**
 * Give reminders IDs. The client always sends the full set, so a reminder that
 * matches an existing one keeps its ID: the ID is part of the dedupe key, and a
 * new one would fire an already-fired reminder again.
 */
function withIds(list: ReminderInput[], existing: Reminder[] = []): Reminder[] {
  const unused = [...existing];
  const same = (a: Reminder, b: ReminderInput) =>
    a.kind === "relative" ? b.kind === "relative" && a.offsetMin === b.offsetMin : b.kind === "absolute" && Date.parse(a.at) === Date.parse(b.at);
  const key = (r: Reminder | ReminderInput) => (r.kind === "relative" ? `rel:${r.offsetMin}` : `abs:${Date.parse(r.at)}`);
  const out: Reminder[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    // Two identical reminders are one: a second row would fire twice (no DB
    // unique constraint catches it, so dedupe here).
    const k = key(r);
    if (seen.has(k)) continue;
    seen.add(k);
    const i = unused.findIndex((e) => same(e, r));
    const id = i >= 0 ? unused.splice(i, 1)[0]!.id : randomUUID();
    out.push({ ...r, id } as Reminder);
  }
  return out;
}

/**
 * Absolute reminders move with recurrence (§12.6). Each moved one gets a new
 * ID, so its dedupe key is new and it fires again for the next occurrence.
 */
function shiftAbsolute(list: Reminder[], days: number, tz: string): Reminder[] {
  return list.map((r) => (r.kind === "absolute" ? { ...r, id: randomUUID(), at: shiftInstant(r.at, days, tz) } : r));
}

/** The task as `viewer` sees it: shared fields plus their own filing and labels. */
function view(t: StoredTask, placement: Placement | undefined, labels: string[] | undefined): Task {
  const { deletedAt: _deleted, ...core } = t;
  return { ...core, projectId: placement?.projectId ?? null, position: placement?.position ?? 0, labels: labels ?? [] };
}

async function viewOne(repo: TaskRepo, me: string, t: StoredTask): Promise<Task> {
  // One after the other: this runs inside the task's transaction, whose single
  // client must not get concurrent queries (pg 9 drops that; v5 2.12).
  const placements = await repo.placements(me);
  const labels = await repo.labelLinks(me);
  return view(t, placements.get(t.id), labels.get(t.id));
}

/** The viewer's label IDs for these names; unknown names become new labels (§12.4 `+label`). */
async function ensureLabels(repo: TaskRepo, me: string, names: string[]): Promise<string[]> {
  const byName = async () => new Map((await repo.labels(me)).map((l) => [l.name.toLowerCase(), l.id]));
  let known = await byName();
  const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const missing = wanted.filter((n) => !known.has(n.toLowerCase()));
  if (missing.length) {
    // Insert ignores a name another request created first, so re-read to get the winning IDs.
    for (const name of missing) await repo.insertLabel({ id: randomUUID(), owner: me, name, color: "grey" });
    known = await byName();
  }
  return [...new Set(wanted.map((n) => known.get(n.toLowerCase())).filter((id): id is string => !!id))];
}

async function ownProject(repo: TaskRepo, me: string, id: string | null): Promise<boolean> {
  if (id == null) return true;
  return (await repo.projects(me)).some((p) => p.id === id && !p.archived);
}

export async function listTasks(viewer: string): Promise<{ tasks: Task[]; projects: TaskProject[]; labels: TaskLabel[] }> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  repo.noteSignedIn(me);
  const [stored, placements, labelLinks, projects, labels] = await Promise.all([
    repo.listVisible(me),
    repo.placements(me),
    repo.labelLinks(me),
    repo.projects(me),
    repo.labels(me),
  ]);
  return {
    tasks: stored.map((t) => view(t, placements.get(t.id), labelLinks.get(t.id))),
    projects: projects.map(({ owner: _o, ...p }) => p).sort((a, b) => a.position - b.position),
    labels: labels.map(({ owner: _o, ...l }) => l).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function getTask(viewer: string, id: string): Promise<Result<Task>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  const t = await repo.getVisible(me, id);
  return t ? { ok: true, value: await viewOne(repo, me, t) } : notFound;
}

export async function createTask(viewer: string, input: CreateTaskInput, assignable: Assignable, resolve: Resolve = noResolve): Promise<Result<Task>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  if (input.assignee && input.assignee !== me && !assignable(input.assignee)) return bad(`unknown assignee: ${input.assignee}`);
  const { links, missing } = resolveLinks(input.links, resolve);
  if (missing.length) return bad(`unknown issue or PR: #${missing.join(", #")}`);
  if (input.parentId) {
    const parent = await repo.getVisible(me, input.parentId);
    if (!parent) return bad("unknown parent task");
    if (parent.parentId) return bad("sub-tasks can't have sub-tasks");
  }
  if (!(await ownProject(repo, me, input.projectId))) return bad("unknown project");
  // An empty title takes the first linked item's title (§12.1).
  const title = input.title || (links[0] ? resolve(links[0].number)?.title : "") || "";
  if (!title) return bad("title required");

  const now = new Date().toISOString();
  const dueTz = input.dueDate ? (input.tz ?? (await repo.prefs(me)).tz ?? "UTC") : null;
  const task: StoredTask = {
    id: randomUUID(),
    creator: me,
    // Assigning to yourself is the same as not assigning (§12.1).
    assignee: input.assignee === me ? null : input.assignee,
    parentId: input.parentId,
    title,
    description: input.description,
    priority: input.priority,
    dueDate: input.dueDate,
    dueTime: input.dueDate ? input.dueTime : null,
    dueTz,
    recurrence: input.recurrence && input.dueDate ? pinMonthDay(input.recurrence, input.dueDate) : null,
    reminders: withIds(input.reminders),
    completedAt: null,
    completedBy: null,
    links,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  // One transaction (v5 1.7): a failure after the insert (ensureLabels, say)
  // used to return 500 with the task already saved, and the client's retry
  // made a duplicate.
  await repo.locked(task.id, async () => {
    await repo.insert(task);
    // The creator files it; the assignee's copy starts in their Inbox (Q2).
    if (input.projectId || !input.parentId) {
      await repo.setPlacement(task.id, me, { projectId: input.projectId, position: (await repo.maxPosition(me, input.projectId)) + 1 });
    }
    if (input.labels.length) await repo.setLabelLinks(task.id, me, await ensureLabels(repo, me, input.labels));
  });
  if (task.assignee) await notifyEvent("assigned", task, me, [task.assignee], randomUUID());
  return { ok: true, value: await viewOne(repo, me, task) };
}

const PERSONAL_FIELDS = new Set<keyof PatchTaskInput>(["projectId", "position", "labels", "expectedUpdatedAt"]);
// They can already see the task, so 403 rather than 404 (like delete).
const cantEdit = { ok: false, status: 403, error: "only the creator and the assignee can change this task" } as const;

/**
 * Update a task. The read, the checks and every write run under the task's
 * row lock in one transaction (S9), so a double-click or two tabs can't log a
 * recurring task's completion twice or move its date twice. Notifications go
 * out after the commit.
 */
export async function updateTask(viewer: string, id: string, patch: PatchTaskInput, assignable: Assignable, resolve: Resolve = noResolve): Promise<Result<Task>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  const out = await repo.locked(id, () => applyUpdate(repo, me, id, patch, assignable, resolve));
  if (!("prev" in out)) return out.result;
  const { prev, merged, completed } = out;
  // Events are one-off, so each gets its own key (only reminders dedupe).
  if (merged.assignee && merged.assignee !== prev.assignee) await notifyEvent("assigned", merged, me, [merged.assignee], randomUUID());
  if (completed) await notifyEvent("completed", merged, me, [prev.creator], randomUUID());
  return out.result;
}

type Applied = { result: Result<Task>; prev: StoredTask; merged: StoredTask; completed: boolean };

async function applyUpdate(
  repo: TaskRepo,
  me: string,
  id: string,
  patch: PatchTaskInput,
  assignable: Assignable,
  resolve: Resolve,
): Promise<Applied | { result: Extract<Result<Task>, { ok: false }> }> {
  const prev = await repo.getVisible(me, id);
  if (!prev) return { result: notFound };
  // Project, position and labels are the viewer's own filing; everything else
  // is shared and needs edit rights.
  const shared = (Object.keys(patch) as (keyof PatchTaskInput)[]).some((k) => patch[k] !== undefined && !PERSONAL_FIELDS.has(k));
  if (shared && !canEdit(prev, me)) return { result: cantEdit };
  // Optimistic concurrency: a shared change based on an older version of the
  // task is refused, with the current task so the client can show it.
  if (shared && patch.expectedUpdatedAt !== undefined && Date.parse(patch.expectedUpdatedAt) !== Date.parse(prev.updatedAt)) {
    return { result: { ok: false, status: 409, error: "task changed elsewhere", current: await viewOne(repo, me, prev) } };
  }
  const next: Partial<StoredTask> = {};
  if (patch.title !== undefined) next.title = patch.title;
  if (patch.description !== undefined) next.description = patch.description;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.dueDate !== undefined) next.dueDate = patch.dueDate;
  if (patch.dueTime !== undefined) next.dueTime = patch.dueTime;
  if (patch.tz !== undefined) next.dueTz = patch.tz;
  if (patch.recurrence !== undefined) next.recurrence = patch.recurrence;
  if (patch.reminders !== undefined) next.reminders = withIds(patch.reminders, prev.reminders);
  // Every refusal comes before the first write (v5 1.7): a request refused
  // after the completion row was deleted left the row gone and the date unmoved.
  if (patch.undoOccurrence !== undefined) {
    // Undo completing an occurrence (U1): only an earlier occurrence of a recurring task.
    if (!prev.recurrence || !prev.dueDate || patch.undoOccurrence >= prev.dueDate || patch.completed !== undefined) {
      return { result: bad("nothing to undo") };
    }
  }
  if (patch.assignee !== undefined) {
    const a = patch.assignee === prev.creator ? null : patch.assignee;
    if (a && a !== prev.assignee && a !== me && !assignable(a)) return { result: bad(`unknown assignee: ${a}`) };
    next.assignee = a;
  }
  if (patch.links !== undefined) {
    const { links, missing } = resolveLinks(patch.links, resolve, prev.links);
    if (missing.length) return { result: bad(`unknown issue or PR: #${missing.join(", #")}`) };
    next.links = links;
  }
  if (patch.projectId !== undefined && !(await ownProject(repo, me, patch.projectId))) return { result: bad("unknown project") };

  if (patch.undoOccurrence !== undefined && prev.recurrence && prev.dueDate) {
    // Drop its completion row and move the date (and absolute reminders) back to it.
    if (await repo.removeCompletion(id, patch.undoOccurrence)) {
      next.dueDate = patch.undoOccurrence;
      next.reminders = shiftAbsolute(next.reminders ?? prev.reminders, daysBetween(prev.dueDate, patch.undoOccurrence), prev.dueTz || "UTC");
    }
  }
  const dueDate = next.dueDate !== undefined ? next.dueDate : prev.dueDate;
  if (!dueDate) {
    // No date, no time or recurrence.
    if (prev.dueTime || next.dueTime) next.dueTime = null;
    if (prev.recurrence || next.recurrence) next.recurrence = null;
  } else {
    if (!prev.dueTz && next.dueTz === undefined) next.dueTz = (await repo.prefs(me)).tz ?? "UTC";
    if (next.recurrence) next.recurrence = pinMonthDay(next.recurrence, dueDate);
  }
  const now = new Date().toISOString();
  const recurrence = next.recurrence !== undefined ? next.recurrence : prev.recurrence;
  let completedOccurrence = false;
  let completed = false;
  if (patch.completed && !prev.completedAt && recurrence && dueDate && !patch.endRecurrence) {
    // Completing a recurring task logs the occurrence and moves the due date (§12.5).
    const today = localToday(new Date(), (next.dueTz ?? prev.dueTz) || "UTC");
    const following = nextOccurrence(recurrence.rule, recurrence.fromCompletion ? today : dueDate);
    if (following) {
      completedOccurrence = true;
      // Already logged (a concurrent request won): don't move the date again.
      if (await repo.addCompletion(id, me, dueDate)) {
        completed = true;
        next.dueDate = following;
        next.reminders = shiftAbsolute(next.reminders ?? prev.reminders, daysBetween(dueDate, following), (next.dueTz ?? prev.dueTz) || "UTC");
        for (const c of await repo.children(me, id)) if (c.completedAt) await repo.update(c.id, { completedAt: null, completedBy: null, updatedAt: now });
      }
    }
  }
  if (!completedOccurrence && patch.completed !== undefined && patch.completed !== Boolean(prev.completedAt)) {
    next.completedAt = patch.completed ? now : null;
    next.completedBy = patch.completed ? me : null;
    if (patch.completed && patch.endRecurrence) next.recurrence = null;
    completed = patch.completed;
  }
  next.updatedAt = now;
  await repo.update(id, next);
  const merged = { ...prev, ...next };

  // A recurring task's sub-tasks reopen for the next occurrence (§12.5), so
  // there is nothing to cascade to.
  if (patch.completed && patch.cascade && !completedOccurrence) {
    for (const c of await repo.children(me, id)) {
      if (!c.completedAt) await repo.update(c.id, { completedAt: now, completedBy: me, updatedAt: now });
    }
  }
  if (patch.projectId !== undefined || patch.position !== undefined) {
    const current = (await repo.placements(me)).get(id) ?? { projectId: null, position: 0 };
    const projectId = patch.projectId !== undefined ? patch.projectId : current.projectId;
    const moved = projectId !== current.projectId;
    const position = patch.position ?? (moved ? (await repo.maxPosition(me, projectId)) + 1 : current.position);
    await repo.setPlacement(id, me, { projectId, position });
  }
  if (patch.labels !== undefined) await repo.setLabelLinks(id, me, await ensureLabels(repo, me, patch.labels));

  return { result: { ok: true, value: await viewOne(repo, me, merged) }, prev, merged, completed };
}

export async function deleteTask(viewer: string, id: string): Promise<Result<true>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  // The whole delete runs under the task's row lock in one transaction (S9),
  // so a crash can't leave the parent deleted and its sub-tasks or comments
  // behind, and a concurrent restore can't race it.
  return repo.locked(id, async () => {
    const t = await repo.getVisible(me, id);
    if (!t) return notFound;
    // The assignee can see the task but may not delete it (Q3). They already
    // know it exists, so this is a 403 rather than a 404.
    if (!canDelete(t, me)) return { ok: false, status: 403, error: "only the creator can delete a task" };
    const now = new Date().toISOString();
    // Read the sub-tasks first: once the parent is gone, those someone else
    // created are no longer visible to the viewer and would be left behind.
    const children = await repo.children(me, id);
    await repo.update(id, { deletedAt: now, updatedAt: now });
    // Sub-tasks go with their parent; comments and notifications go with each.
    // Everything soft-deleted here carries the same time, so an undo (U1)
    // brings back exactly this delete.
    for (const c of children) {
      await repo.update(c.id, { deletedAt: now, updatedAt: now });
      await repo.deleteCommentsForTask(c.id, now);
      await repo.deleteNotificationsForTask(c.id);
    }
    await repo.deleteCommentsForTask(id, now);
    await repo.deleteNotificationsForTask(id);
    return { ok: true, value: true } as const;
  });
}

// --- comments (§12.7) ------------------------------------------------------------


/**
 * Undo a delete (U1): only the creator, while the task is still soft-deleted
 * (RETENTION_DELETED_DAYS). Links, labels and placements were never removed;
 * sub-tasks and comments deleted with it come back too.
 */
export async function restoreTask(viewer: string, id: string): Promise<Result<Task>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  return repo.locked(id, async () => {
    const t = await repo.getDeletedByCreator(me, id);
    if (!t?.deletedAt) return notFound;
    await repo.restoreTask(id, t.deletedAt);
    const back = await repo.getVisible(me, id);
    return back ? { ok: true, value: await viewOne(repo, me, back) } : notFound;
  });
}

export async function listComments(viewer: string, taskId: string): Promise<Result<TaskComment[]>> {
  const repo = taskRepo();
  if (!(await repo.getVisible(normLogin(viewer), taskId))) return notFound;
  return { ok: true, value: await repo.comments(taskId) };
}

export async function addComment(viewer: string, taskId: string, body: string): Promise<Result<TaskComment>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  const task = await repo.getVisible(me, taskId);
  if (!task) return notFound;
  if (!canEdit(task, me)) return cantEdit;
  const now = new Date().toISOString();
  const c: TaskComment = { id: randomUUID(), taskId, author: me, body, createdAt: now, updatedAt: now };
  await repo.insertComment(c);
  // The other participants hear about it; never the author (§12.6).
  await notifyEvent("comment", task, me, [task.creator, task.assignee], c.id);
  return { ok: true, value: c };
}

async function ownComment(viewer: string, taskId: string, id: string): Promise<Result<TaskComment>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  if (!(await repo.getVisible(me, taskId))) return notFound;
  const c = await repo.comment(taskId, id);
  if (!c) return { ok: false, status: 404, error: "comment not found" };
  if (c.author !== me) return { ok: false, status: 403, error: "only the author can change a comment" };
  return { ok: true, value: c };
}

export async function editComment(viewer: string, taskId: string, id: string, body: string): Promise<Result<TaskComment>> {
  const r = await ownComment(viewer, taskId, id);
  if (!r.ok) return r;
  await taskRepo().updateComment(id, body);
  return { ok: true, value: { ...r.value, body, updatedAt: new Date().toISOString() } };
}

export async function removeComment(viewer: string, taskId: string, id: string): Promise<Result<true>> {
  const r = await ownComment(viewer, taskId, id);
  if (!r.ok) return r;
  await taskRepo().deleteComment(id);
  return { ok: true, value: true };
}

// --- notifications and preferences (§12.6) --------------------------------------

/** Fire the viewer's due reminders, then return their latest notifications. */
export async function notificationsFor(viewer: string, now = new Date()): Promise<{ list: AppNotification[]; unread: number }> {
  const me = normLogin(viewer);
  await fireReminders(now, me);
  // The daily watchlist digest (F6). A failure here must never cost the person their notifications.
  await fireWatchDigest(me, now).catch((e) => console.error(`deska: watch digest failed: ${String(e)}`));
  return taskRepo().notifications(me, 50);
}

export async function markNotificationsRead(viewer: string, ids: string[] | "all"): Promise<void> {
  await taskRepo().markRead(normLogin(viewer), ids);
}

export async function getPrefs(viewer: string): Promise<Prefs> {
  return taskRepo().prefs(normLogin(viewer));
}

export async function setPrefs(viewer: string, p: Partial<Prefs>): Promise<Prefs> {
  return taskRepo().setPrefs(normLogin(viewer), p);
}

// --- projects and labels (personal, §12.3) ----------------------------------------

export async function createProject(viewer: string, input: { name: string; color: string }): Promise<Result<TaskProject>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  const all = await repo.projects(me);
  if (all.some((x) => x.name.toLowerCase() === input.name.trim().toLowerCase())) return bad("a project with that name exists");
  const p = { id: randomUUID(), owner: me, name: input.name, color: input.color, position: Math.max(0, ...all.map((x) => x.position)) + 1, archived: false, source: null };
  // The check above is not atomic: the unique index decides a race.
  if (!(await repo.insertProject(p))) return { ok: false, status: 409, error: "a project with that name exists" };
  const { owner: _o, ...out } = p;
  return { ok: true, value: out };
}

export async function updateProject(
  viewer: string,
  id: string,
  patch: Partial<{ name: string; color: string; position: number; archived: boolean; source: ProjectSource | null }>,
): Promise<Result<TaskProject>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  const all = await repo.projects(me);
  const prev = all.find((p) => p.id === id);
  if (!prev) return { ok: false, status: 404, error: "project not found" };
  if (patch.name && all.some((p) => p.id !== id && p.name.toLowerCase() === patch.name!.trim().toLowerCase())) return bad("a project with that name exists");
  await repo.updateProject(id, patch);
  const { owner: _o, ...out } = { ...prev, ...patch };
  return { ok: true, value: out };
}

export async function createLabel(viewer: string, input: { name: string; color: string }): Promise<Result<TaskLabel>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  if ((await repo.labels(me)).some((l) => l.name.toLowerCase() === input.name.toLowerCase())) return bad("a label with that name exists");
  const l = { id: randomUUID(), owner: me, name: input.name, color: input.color };
  if (!(await repo.insertLabel(l))) return bad("a label with that name exists");
  const { owner: _o, ...out } = l;
  return { ok: true, value: out };
}

export async function updateLabel(viewer: string, id: string, patch: Partial<{ name: string; color: string }>): Promise<Result<TaskLabel>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  const mine = await repo.labels(me);
  const prev = mine.find((l) => l.id === id);
  if (!prev) return { ok: false, status: 404, error: "label not found" };
  if (patch.name && mine.some((l) => l.id !== id && l.name.toLowerCase() === patch.name!.toLowerCase())) return bad("a label with that name exists");
  await repo.updateLabel(id, patch);
  const { owner: _o, ...out } = { ...prev, ...patch };
  return { ok: true, value: out };
}

export async function deleteLabel(viewer: string, id: string): Promise<Result<true>> {
  const repo = taskRepo();
  const me = normLogin(viewer);
  if (!(await repo.labels(me)).some((l) => l.id === id)) return { ok: false, status: 404, error: "label not found" };
  await repo.deleteLabel(id);
  return { ok: true, value: true };
}

/**
 * Can each login see their tasks yet? `blocked` when the current access rule
 * refuses them, `pending` when allowed but never signed in, else `active`.
 */
export async function accessFor(logins: Iterable<string>, viewer: string): Promise<Record<string, Access>> {
  const signedIn = await taskRepo().signedInLogins();
  signedIn.add(normLogin(viewer));
  const out: Record<string, Access> = {};
  for (const raw of logins) {
    const l = normLogin(raw);
    out[l] = !canSignIn(l) ? "blocked" : signedIn.has(l) ? "active" : "pending";
  }
  return out;
}
