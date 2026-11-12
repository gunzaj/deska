import { randomUUID } from "node:crypto";
import { addDays, daysBetween, localToday, shiftInstant, zonedToUtc } from "./dates";
import { tasksChanged } from "../desktop/events";
import {
  COMPLETED_DAYS,
  type AppNotification,
  type CompletedItem,
  type CreateTaskInput,
  type PatchTaskInput,
  type SearchHit,
  type Prefs,
  type ProjectSource,
  type Reminder,
  type ReminderInput,
  type Task,
  type TaskComment,
  type TaskLabel,
  type TaskLink,
  type TaskProject,
  type TaskSection,
} from "./model";
import { fireWatchDigest } from "../watch/digest";
import { DEFAULT_REMINDER_TIME, fireReminders } from "./notify";
import { nextOccurrence, pinMonthDay, repinMonthDay } from "./recurrence";
import { SEARCH_LIMIT, taskRepo, type Placement, type StoredSection, type StoredTask, type TaskRepo } from "./repo";

/**
 * Task operations for the API (SPEC §12). Nothing here calls GitHub or depends
 * on WRITE_MODE: tasks are Deska-native data.
 *
 * Every function takes the owner key (LOCAL_OWNER, lib/local-owner.ts): all
 * tasks belong to this install, whichever GitHub account is connected (§4.6).
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 403 | 404; error: string }
  /** The task changed since the client's `expectedUpdatedAt` (S9). */
  | { ok: false; status: 409; error: string; current: Task }
  /** A unique name was taken between the check and the insert. */
  | { ok: false; status: 409; error: string; current?: undefined };

/** Look up an issue in the cache by number. */
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
    const match = i >= 0 ? unused.splice(i, 1)[0]! : null;
    // A snooze stays one: the client resends the set without the flag.
    const snooze = r.kind === "absolute" && (r.snooze || (match?.kind === "absolute" && match.snooze));
    const { snooze: _s, ...rest } = r as ReminderInput & { snooze?: true };
    out.push({ ...rest, id: match?.id ?? randomUUID(), ...(snooze ? { snooze: true } : {}) } as Reminder);
  }
  return out;
}

/**
 * Absolute reminders move with recurrence (§12.6). A moved one keeps its ID:
 * the dedupe key has the instant in it (notify.ts), so it fires again for the
 * next occurrence, and an undo that moves it back finds the key it already
 * fired under. A snooze belonged to the occurrence just completed: it is
 * dropped, not moved (`dropSnoozes`); an undo leaves snoozes where they are.
 */
function shiftAbsolute(list: Reminder[], days: number, tz: string, dropSnoozes: boolean): Reminder[] {
  return list.flatMap((r): Reminder[] => {
    if (r.kind !== "absolute") return [r];
    if (r.snooze) return dropSnoozes ? [] : [r];
    return [{ ...r, at: shiftInstant(r.at, days, tz) }];
  });
}

/** The task with its filing and labels. */
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

/** The label IDs for these names; unknown names become new labels (§12.4 `+label`). */
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

/** A section the viewer owns, in the project it belongs to. */
async function ownSection(repo: TaskRepo, me: string, id: string): Promise<StoredSection | null> {
  return (await repo.sections(me)).find((s) => s.id === id) ?? null;
}

const publicSection = ({ owner: _o, ...s }: StoredSection): TaskSection => s;

export async function listTasks(me: string): Promise<{ tasks: Task[]; projects: TaskProject[]; labels: TaskLabel[]; sections: TaskSection[] }> {
  const repo = taskRepo();
  const [stored, placements, labelLinks, projects, labels, sections] = await Promise.all([
    repo.list(),
    repo.placements(me),
    repo.labelLinks(me),
    repo.projects(me),
    repo.labels(me),
    repo.sections(me),
  ]);
  return {
    tasks: stored.map((t) => view(t, placements.get(t.id), labelLinks.get(t.id))),
    projects: projects.map(({ owner: _o, ...p }) => p).sort((a, b) => a.position - b.position),
    labels: labels.map(({ owner: _o, ...l }) => l).sort((a, b) => a.name.localeCompare(b.name)),
    sections: sections.map(publicSection).sort((a, b) => a.position - b.position),
  };
}

export async function getTask(me: string, id: string): Promise<Result<Task>> {
  const repo = taskRepo();
  const t = await repo.get(id);
  return t ? { ok: true, value: await viewOne(repo, me, t) } : notFound;
}

/** Validate one create input and build its task, before anything is written. */
async function prepareTask(repo: TaskRepo, me: string, input: CreateTaskInput, resolve: Resolve): Promise<Result<StoredTask>> {
  const { links, missing } = resolveLinks(input.links, resolve);
  if (missing.length) return bad(`unknown issue: #${missing.join(", #")}`);
  if (input.parentId) {
    const parent = await repo.get(input.parentId);
    if (!parent) return bad("unknown parent task");
    if (parent.parentId) return bad("sub-tasks can't have sub-tasks");
  }
  if (!(await ownProject(repo, me, input.projectId))) return bad("unknown project");
  if (input.sectionId) {
    const section = await ownSection(repo, me, input.sectionId);
    if (input.parentId || !section || section.projectId !== input.projectId) return bad("unknown section");
  }
  // An empty title takes the first linked item's title (§12.1).
  const title = input.title || (links[0] ? resolve(links[0].number)?.title : "") || "";
  if (!title) return bad("title required");

  const now = new Date().toISOString();
  const dueTz = input.dueDate ? (input.tz ?? (await repo.prefs(me)).tz ?? "UTC") : null;
  return {
    ok: true,
    value: {
      id: randomUUID(),
      creator: me,
      parentId: input.parentId,
      sectionId: input.sectionId,
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
    },
  };
}

/** The task, its placement and its labels, inside the caller's transaction. */
async function insertTask(repo: TaskRepo, me: string, task: StoredTask, input: CreateTaskInput): Promise<void> {
  await repo.insert(task);
  if (input.projectId || !input.parentId) {
    await repo.setPlacement(task.id, me, { projectId: input.projectId, position: (await repo.maxPosition(me, input.projectId)) + 1 });
  }
  if (input.labels.length) await repo.setLabelLinks(task.id, me, await ensureLabels(repo, me, input.labels));
}

export async function createTask(me: string, input: CreateTaskInput, resolve: Resolve = noResolve): Promise<Result<Task>> {
  const repo = taskRepo();
  const prepared = await prepareTask(repo, me, input, resolve);
  if (!prepared.ok) return prepared;
  const task = prepared.value;
  // One transaction (v5 1.7): a failure after the insert (ensureLabels, say)
  // used to return 500 with the task already saved, and the client's retry
  // made a duplicate.
  await repo.locked(task.id, async () => {
    await insertTask(repo, me, task, input);
  });
  tasksChanged();
  return { ok: true, value: await viewOne(repo, me, task) };
}

/**
 * Create several tasks in one transaction (item 13): every input is validated
 * first, then the tasks, placements and labels are written together, so a batch
 * that fails part-way leaves none of them behind.
 */
export async function createTasks(me: string, inputs: CreateTaskInput[], resolve: Resolve = noResolve): Promise<Result<Task[]>> {
  const repo = taskRepo();
  const prepared: StoredTask[] = [];
  for (const input of inputs) {
    const r = await prepareTask(repo, me, input, resolve);
    if (!r.ok) return r;
    prepared.push(r.value);
  }
  // A random id only opens the transaction; no row is locked.
  const r = await repo.locked<Result<true>>(randomUUID(), async () => {
    for (let i = 0; i < prepared.length; i++) await insertTask(repo, me, prepared[i]!, inputs[i]!);
    return { ok: true, value: true };
  });
  if (!r.ok) return r;
  tasksChanged();
  return { ok: true, value: await Promise.all(prepared.map((t) => viewOne(repo, me, t))) };
}

// Filing changes (project, position, labels) are never refused for a stale task.
const FILING_FIELDS = new Set<keyof PatchTaskInput>(["projectId", "position", "sectionId", "labels", "expectedUpdatedAt"]);

/**
 * Update a task. The read, the checks and every write run under the task's
 * row lock in one transaction (S9), so a double-click or two tabs can't log a
 * recurring task's completion twice or move its date twice.
 */
export async function updateTask(me: string, id: string, patch: PatchTaskInput, resolve: Resolve = noResolve): Promise<Result<Task>> {
  const repo = taskRepo();
  const r = await repo.locked(id, () => applyUpdate(repo, me, id, patch, resolve));
  if (r.ok) tasksChanged();
  return r;
}

/**
 * Snooze a reminder (SPEC §4.6): remind again in an hour, or tomorrow morning
 * (09:00 in the task's time zone). It adds a one-shot absolute reminder marked
 * `snooze`, so the next firing has its own dedupe key and completing the
 * occurrence drops it. Snoozes already in the past have fired and are dropped,
 * so repeated snoozes don't pile up; the task's own reminders are kept, past
 * or not, since a recurring task's move on to the next occurrence.
 */
export async function snoozeTask(me: string, id: string, when: "1h" | "tomorrow", now = new Date()): Promise<Result<Task>> {
  const repo = taskRepo();
  const t = await repo.get(id);
  if (!t) return notFound;
  if (t.completedAt) return bad("task is completed");
  const tz = t.dueTz ?? (await repo.prefs(me)).tz ?? "UTC";
  const at = when === "1h" ? new Date(now.getTime() + 60 * 60_000) : zonedToUtc(addDays(localToday(now, tz), 1), DEFAULT_REMINDER_TIME, tz);
  const keep = t.reminders.filter((r) => r.kind === "relative" || !r.snooze || Date.parse(r.at) > now.getTime());
  const reminders = [
    ...keep.map((r): ReminderInput => (r.kind === "relative" ? { kind: "relative", offsetMin: r.offsetMin } : { kind: "absolute", at: r.at, ...(r.snooze ? { snooze: true as const } : {}) })),
    { kind: "absolute" as const, at: at.toISOString(), snooze: true as const },
  ].slice(-10);
  return updateTask(me, id, { reminders });
}

async function applyUpdate(repo: TaskRepo, me: string, id: string, patch: PatchTaskInput, resolve: Resolve): Promise<Result<Task>> {
  const prev = await repo.get(id);
  if (!prev) return notFound;
  const shared = (Object.keys(patch) as (keyof PatchTaskInput)[]).some((k) => patch[k] !== undefined && !FILING_FIELDS.has(k));
  // Optimistic concurrency: a shared change based on an older version of the
  // task is refused, with the current task so the client can show it.
  if (shared && patch.expectedUpdatedAt !== undefined && Date.parse(patch.expectedUpdatedAt) !== Date.parse(prev.updatedAt)) {
    return { ok: false, status: 409, error: "task changed elsewhere", current: await viewOne(repo, me, prev) };
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
      return bad("nothing to undo");
    }
  }
  if (patch.links !== undefined) {
    const { links, missing } = resolveLinks(patch.links, resolve, prev.links);
    if (missing.length) return bad(`unknown issue: #${missing.join(", #")}`);
    next.links = links;
  }
  if (patch.projectId !== undefined && !(await ownProject(repo, me, patch.projectId))) return bad("unknown project");
  // Where it is filed now, and where it will be: a section only fits its own project.
  const filing = patch.projectId !== undefined || patch.sectionId !== undefined || patch.position !== undefined ? ((await repo.placements(me)).get(id) ?? { projectId: null, position: 0 }) : null;
  if (filing && (patch.projectId !== undefined || patch.sectionId !== undefined)) {
    const projectId = patch.projectId !== undefined ? patch.projectId : filing.projectId;
    // Moving to another project drops the old section unless the patch names one in the new project.
    const sectionId = patch.sectionId !== undefined ? patch.sectionId : projectId !== filing.projectId ? null : prev.sectionId;
    if (sectionId) {
      const section = await ownSection(repo, me, sectionId);
      if (prev.parentId || !section || section.projectId !== projectId) return bad("unknown section");
    }
    if (sectionId !== prev.sectionId) next.sectionId = sectionId;
  }

  if (patch.undoOccurrence !== undefined && prev.recurrence && prev.dueDate) {
    // Drop its completion row and move the date (and absolute reminders) back to it.
    if (await repo.removeCompletion(id, patch.undoOccurrence)) {
      next.dueDate = patch.undoOccurrence;
      next.reminders = shiftAbsolute(next.reminders ?? prev.reminders, daysBetween(prev.dueDate, patch.undoOccurrence), prev.dueTz || "UTC", false);
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
    // The user moved the date: a day of the month taken from the old date
    // follows it (an explicitly chosen one stays).
    else if (patch.dueDate !== undefined && patch.dueDate !== prev.dueDate && patch.undoOccurrence === undefined && next.recurrence === undefined && prev.recurrence) {
      const r = repinMonthDay(prev.recurrence, dueDate);
      if (r !== prev.recurrence) next.recurrence = r;
    }
  }
  const now = new Date().toISOString();
  const recurrence = next.recurrence !== undefined ? next.recurrence : prev.recurrence;
  let completedOccurrence = false;
  if (patch.completed && !prev.completedAt && recurrence && dueDate && !patch.endRecurrence) {
    // Completing a recurring task logs the occurrence and moves the due date (§12.5).
    const today = localToday(new Date(), (next.dueTz ?? prev.dueTz) || "UTC");
    let following = nextOccurrence(recurrence.rule, recurrence.fromCompletion ? today : dueDate);
    // "every!" completed early: the next date counted from today can land on (or
    // before) the current due date. The date must move past it, or the occurrence
    // is logged without moving and every later completion is refused as a repeat.
    if (following && following <= dueDate) following = nextOccurrence(recurrence.rule, dueDate);
    if (following) {
      completedOccurrence = true;
      // Already logged (a concurrent request won): don't move the date again.
      if (await repo.addCompletion(id, me, dueDate)) {
        next.dueDate = following;
        next.reminders = shiftAbsolute(next.reminders ?? prev.reminders, daysBetween(dueDate, following), (next.dueTz ?? prev.dueTz) || "UTC", true);
        for (const c of await repo.children(id)) if (c.completedAt) await repo.update(c.id, { completedAt: null, completedBy: null, updatedAt: now });
      }
    }
  }
  if (!completedOccurrence && patch.completed !== undefined && patch.completed !== Boolean(prev.completedAt)) {
    next.completedAt = patch.completed ? now : null;
    next.completedBy = patch.completed ? me : null;
    if (patch.completed && patch.endRecurrence) next.recurrence = null;
  }
  next.updatedAt = now;
  await repo.update(id, next);
  const merged = { ...prev, ...next };

  // A recurring task's sub-tasks reopen for the next occurrence (§12.5), so
  // there is nothing to cascade to.
  if (patch.completed && patch.cascade && !completedOccurrence) {
    for (const c of await repo.children(id)) {
      if (!c.completedAt) await repo.update(c.id, { completedAt: now, completedBy: me, updatedAt: now });
    }
  }
  if (filing && (patch.projectId !== undefined || patch.position !== undefined)) {
    const current = filing;
    const projectId = patch.projectId !== undefined ? patch.projectId : current.projectId;
    const moved = projectId !== current.projectId;
    const position = patch.position ?? (moved ? (await repo.maxPosition(me, projectId)) + 1 : current.position);
    await repo.setPlacement(id, me, { projectId, position });
  }
  if (patch.labels !== undefined) await repo.setLabelLinks(id, me, await ensureLabels(repo, me, patch.labels));

  return { ok: true, value: await viewOne(repo, me, merged) };
}

export async function deleteTask(_me: string, id: string): Promise<Result<true>> {
  const repo = taskRepo();
  // The whole delete runs under the task's row lock in one transaction (S9),
  // so a crash can't leave the parent deleted and its sub-tasks or comments
  // behind, and a concurrent restore can't race it.
  const r = await repo.locked(id, async (): Promise<Result<true>> => {
    const t = await repo.get(id);
    if (!t) return notFound;
    const now = new Date().toISOString();
    const children = await repo.children(id);
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
    return { ok: true, value: true };
  });
  if (r.ok) tasksChanged();
  return r;
}

// --- comments (§12.7) ------------------------------------------------------------


/**
 * Undo a delete (U1): while the task is still soft-deleted
 * (RETENTION_DELETED_DAYS). Links, labels and placements were never removed;
 * sub-tasks and comments deleted with it come back too. A sub-task whose
 * parent has since been deleted comes back as a top-level task, filed where
 * the parent was (Inbox if that project is gone): Undo always brings back
 * what was deleted, and a sub-task of a deleted parent would be invisible.
 */
export async function restoreTask(me: string, id: string): Promise<Result<Task>> {
  const repo = taskRepo();
  const r = await repo.locked(id, async (): Promise<Result<Task>> => {
    const t = await repo.getDeleted(id);
    if (!t?.deletedAt) return notFound;
    await repo.restoreTask(id, t.deletedAt);
    if (t.parentId && !(await repo.get(t.parentId))) {
      const placements = await repo.placements(me);
      const wanted = placements.get(id)?.projectId ?? placements.get(t.parentId)?.projectId ?? null;
      const projectId = (await ownProject(repo, me, wanted)) ? wanted : null;
      await repo.update(id, { parentId: null, sectionId: null, updatedAt: new Date().toISOString() });
      await repo.setPlacement(id, me, { projectId, position: (await repo.maxPosition(me, projectId)) + 1 });
    }
    const back = await repo.get(id);
    return back ? { ok: true, value: await viewOne(repo, me, back) } : notFound;
  });
  if (r.ok) tasksChanged();
  return r;
}

export async function listComments(_me: string, taskId: string): Promise<Result<TaskComment[]>> {
  const repo = taskRepo();
  if (!(await repo.get(taskId))) return notFound;
  return { ok: true, value: await repo.comments(taskId) };
}

export async function addComment(me: string, taskId: string, body: string): Promise<Result<TaskComment>> {
  const repo = taskRepo();
  if (!(await repo.get(taskId))) return notFound;
  const now = new Date().toISOString();
  const c: TaskComment = { id: randomUUID(), taskId, author: me, body, createdAt: now, updatedAt: now };
  await repo.insertComment(c);
  return { ok: true, value: c };
}

async function findComment(taskId: string, id: string): Promise<Result<TaskComment>> {
  const repo = taskRepo();
  if (!(await repo.get(taskId))) return notFound;
  const c = await repo.comment(taskId, id);
  return c ? { ok: true, value: c } : { ok: false, status: 404, error: "comment not found" };
}

export async function editComment(_me: string, taskId: string, id: string, body: string): Promise<Result<TaskComment>> {
  const r = await findComment(taskId, id);
  if (!r.ok) return r;
  await taskRepo().updateComment(id, body);
  return { ok: true, value: { ...r.value, body, updatedAt: new Date().toISOString() } };
}

export async function removeComment(_me: string, taskId: string, id: string): Promise<Result<true>> {
  const r = await findComment(taskId, id);
  if (!r.ok) return r;
  await taskRepo().deleteComment(id);
  return { ok: true, value: true };
}

// --- notifications and preferences (§12.6) --------------------------------------

/**
 * Fire due reminders, then return the latest notifications. `meLogin` is the
 * GitHub login a watched view's `me` means.
 */
export async function notificationsFor(me: string, now = new Date(), meLogin = ""): Promise<{ list: AppNotification[]; unread: number }> {
  await fireReminders(now, me);
  // The daily watchlist digest (F6). A failure here must never cost the person their notifications.
  await fireWatchDigest(me, now, meLogin).catch((e) => console.error(`deska: watch digest failed: ${String(e)}`));
  return taskRepo().notifications(me, 50);
}

export async function markNotificationsRead(me: string, ids: string[] | "all"): Promise<void> {
  await taskRepo().markRead(me, ids);
}

export async function getPrefs(me: string): Promise<Prefs> {
  return taskRepo().prefs(me);
}

export async function setPrefs(me: string, p: Partial<Prefs>): Promise<Prefs> {
  return taskRepo().setPrefs(me, p);
}

// --- projects and labels (personal, §12.3) ----------------------------------------

export async function createProject(me: string, input: { name: string; color: string }): Promise<Result<TaskProject>> {
  const repo = taskRepo();
  const all = await repo.projects(me);
  if (all.some((x) => x.name.toLowerCase() === input.name.trim().toLowerCase())) return bad("a project with that name exists");
  const p = { id: randomUUID(), owner: me, name: input.name, color: input.color, position: Math.max(0, ...all.map((x) => x.position)) + 1, archived: false, source: null };
  // The check above is not atomic: the unique index decides a race.
  if (!(await repo.insertProject(p))) return { ok: false, status: 409, error: "a project with that name exists" };
  const { owner: _o, ...out } = p;
  return { ok: true, value: out };
}

export async function updateProject(
  me: string,
  id: string,
  patch: Partial<{ name: string; color: string; position: number; archived: boolean; source: ProjectSource | null }>,
): Promise<Result<TaskProject>> {
  const repo = taskRepo();
  const all = await repo.projects(me);
  const prev = all.find((p) => p.id === id);
  if (!prev) return { ok: false, status: 404, error: "project not found" };
  if (patch.name && all.some((p) => p.id !== id && p.name.toLowerCase() === patch.name!.trim().toLowerCase())) return bad("a project with that name exists");
  await repo.updateProject(id, patch);
  const { owner: _o, ...out } = { ...prev, ...patch };
  return { ok: true, value: out };
}

// --- sections (§4.6, D13) ---------------------------------------------------------

export async function createSection(me: string, input: { projectId: string; name: string }): Promise<Result<TaskSection>> {
  const repo = taskRepo();
  if (!(await ownProject(repo, me, input.projectId)) || input.projectId == null) return bad("unknown project");
  const s: StoredSection = { id: randomUUID(), owner: me, projectId: input.projectId, name: input.name, position: (await repo.maxSectionPosition(me, input.projectId)) + 1, collapsed: false };
  await repo.insertSection(s);
  return { ok: true, value: publicSection(s) };
}

export async function updateSection(me: string, id: string, patch: Partial<{ name: string; position: number; collapsed: boolean }>): Promise<Result<TaskSection>> {
  const repo = taskRepo();
  const prev = await ownSection(repo, me, id);
  if (!prev) return { ok: false, status: 404, error: "section not found" };
  await repo.updateSection(id, patch);
  return { ok: true, value: publicSection({ ...prev, ...patch }) };
}

/** Its tasks stay in the project, without a section. */
export async function deleteSection(me: string, id: string): Promise<Result<true>> {
  const repo = taskRepo();
  if (!(await ownSection(repo, me, id))) return { ok: false, status: 404, error: "section not found" };
  await repo.deleteSection(id);
  return { ok: true, value: true };
}

// --- completed view and search (§4.6, D13) -----------------------------------------

/** Most lines either source adds to the Completed view. */
const COMPLETED_CAP = 1000;

/**
 * The last COMPLETED_DAYS days of completions: tasks completed in that time,
 * and occurrences of recurring tasks (which stay open), newest first. Only the
 * newest occurrence of a task can be undone, and only while its due date is
 * still ahead of it.
 */
export async function listCompleted(me: string, now = new Date()): Promise<{ items: CompletedItem[] }> {
  const repo = taskRepo();
  const since = new Date(now.getTime() - COMPLETED_DAYS * 86_400_000).toISOString();
  const [done, occurrences, placements, labelLinks] = await Promise.all([repo.completedSince(since, COMPLETED_CAP), repo.completionsSince(since, COMPLETED_CAP), repo.placements(me), repo.labelLinks(me)]);
  const items: CompletedItem[] = done.map((t) => ({ key: `t:${t.id}`, task: view(t, placements.get(t.id), labelLinks.get(t.id)), at: t.completedAt!, occurrence: null, undoable: true }));
  const seen = new Set<string>();
  const byId = new Map<string, StoredTask | null>();
  for (const o of occurrences) {
    if (!byId.has(o.taskId)) byId.set(o.taskId, await repo.get(o.taskId));
    const t = byId.get(o.taskId);
    if (!t) continue;
    // `occurrences` is newest first: the first one seen for a task is its latest.
    const latest = !seen.has(o.taskId);
    seen.add(o.taskId);
    items.push({
      key: `o:${o.taskId}:${o.dueDate ?? ""}:${o.at}`,
      task: view(t, placements.get(t.id), labelLinks.get(t.id)),
      at: o.at,
      occurrence: o.dueDate,
      undoable: latest && Boolean(t.recurrence && t.dueDate && o.dueDate && o.dueDate < t.dueDate),
    });
  }
  return { items: items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, COMPLETED_CAP) };
}

/** Tasks whose title, description or comments contain every word of `query` (⌘K, §4.6). */
export async function searchTasks(me: string, query: string): Promise<{ hits: SearchHit[] }> {
  const repo = taskRepo();
  const words = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean).map((w) => w.slice(0, 100)))].slice(0, 8);
  if (!words.length) return { hits: [] };
  const [found, placements, labelLinks] = await Promise.all([repo.search(words, SEARCH_LIMIT), repo.placements(me), repo.labelLinks(me)]);
  const all = (text: string) => words.every((w) => text.includes(w));
  return {
    hits: found.map((t) => {
      const title = t.title.toLowerCase();
      const where = all(title) ? "title" : all(`${title}\n${t.description.toLowerCase()}`) ? "description" : "comment";
      return { task: view(t, placements.get(t.id), labelLinks.get(t.id)), in: where };
    }),
  };
}

export async function createLabel(me: string, input: { name: string; color: string }): Promise<Result<TaskLabel>> {
  const repo = taskRepo();
  if ((await repo.labels(me)).some((l) => l.name.toLowerCase() === input.name.toLowerCase())) return bad("a label with that name exists");
  const l = { id: randomUUID(), owner: me, name: input.name, color: input.color };
  if (!(await repo.insertLabel(l))) return bad("a label with that name exists");
  const { owner: _o, ...out } = l;
  return { ok: true, value: out };
}

export async function updateLabel(me: string, id: string, patch: Partial<{ name: string; color: string }>): Promise<Result<TaskLabel>> {
  const repo = taskRepo();
  const mine = await repo.labels(me);
  const prev = mine.find((l) => l.id === id);
  if (!prev) return { ok: false, status: 404, error: "label not found" };
  if (patch.name && mine.some((l) => l.id !== id && l.name.toLowerCase() === patch.name!.toLowerCase())) return bad("a label with that name exists");
  await repo.updateLabel(id, patch);
  const { owner: _o, ...out } = { ...prev, ...patch };
  return { ok: true, value: out };
}

export async function deleteLabel(me: string, id: string): Promise<Result<true>> {
  const repo = taskRepo();
  if (!(await repo.labels(me)).some((l) => l.id === id)) return { ok: false, status: 404, error: "label not found" };
  await repo.deleteLabel(id);
  return { ok: true, value: true };
}
