// Saved task views (item 12), stored in the same `views` table as the issue
// views and told apart by `kind`. Postgres in production; a process-local map
// without a database (dev and tests).
import { and, asc, eq, isNull } from "drizzle-orm";
import { dbDir, getDb } from "@/db";
import { views as viewsTable } from "@/db/schema";
import { newViewId } from "@/lib/views/ids";
import { taskViewSchema, type TaskView, type TaskViewDraft } from "./views";

type Row = { id: string; definitionJson: unknown; deletedAt: Date | null };

class MemoryRepo {
  map = new Map<string, TaskView>();
  deleted = new Map<string, TaskView>();
  async all() {
    return [...this.map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async get(id: string) {
    return this.map.get(id) ?? null;
  }
  async getDeleted(id: string) {
    return this.deleted.get(id) ?? null;
  }
  async put(v: TaskView) {
    this.deleted.delete(v.id);
    this.map.set(v.id, v);
  }
  async add(v: TaskView) {
    if (!this.map.has(v.id) && !this.deleted.has(v.id)) this.map.set(v.id, v);
  }
  async remove(id: string) {
    const v = this.map.get(id);
    if (v) this.deleted.set(id, v);
    this.map.delete(id);
  }
}

class PostgresRepo {
  private parse(row: Row): TaskView | null {
    const parsed = taskViewSchema.safeParse(row.definitionJson);
    return parsed.success ? parsed.data : null;
  }
  async all() {
    const rows = await getDb()
      .select({ id: viewsTable.id, definitionJson: viewsTable.definitionJson, deletedAt: viewsTable.deletedAt })
      .from(viewsTable)
      .where(and(eq(viewsTable.kind, "tasks"), isNull(viewsTable.deletedAt)))
      .orderBy(asc(viewsTable.name));
    return rows.map((r) => this.parse(r)).filter((v): v is TaskView => v != null);
  }
  async get(id: string) {
    const row = (
      await getDb()
        .select({ id: viewsTable.id, definitionJson: viewsTable.definitionJson, deletedAt: viewsTable.deletedAt })
        .from(viewsTable)
        .where(and(eq(viewsTable.id, id), eq(viewsTable.kind, "tasks"), isNull(viewsTable.deletedAt)))
    )[0];
    return row ? this.parse(row) : null;
  }
  async getDeleted(id: string) {
    const row = (
      await getDb()
        .select({ id: viewsTable.id, definitionJson: viewsTable.definitionJson, deletedAt: viewsTable.deletedAt })
        .from(viewsTable)
        .where(and(eq(viewsTable.id, id), eq(viewsTable.kind, "tasks")))
    )[0];
    return row?.deletedAt ? this.parse(row) : null;
  }
  private values(v: TaskView) {
    return { id: v.id, name: v.name, kind: "tasks", definitionJson: v, updatedAt: new Date() };
  }
  async put(v: TaskView) {
    const values = { ...this.values(v), deletedAt: null };
    await getDb()
      .insert(viewsTable)
      .values(values)
      .onConflictDoUpdate({ target: viewsTable.id, set: values });
  }
  async add(v: TaskView) {
    await getDb().insert(viewsTable).values(this.values(v)).onConflictDoNothing({ target: viewsTable.id });
  }
  async remove(id: string) {
    await getDb().update(viewsTable).set({ deletedAt: new Date() }).where(eq(viewsTable.id, id));
  }
}

// On globalThis for the same reason as the issue views (v5 2.10): `next dev`
// loads this module more than once.
const g = globalThis as { __deskaTaskViews?: MemoryRepo };
const memory = (g.__deskaTaskViews ??= new MemoryRepo());

function repo(): MemoryRepo | PostgresRepo {
  return dbDir() ? new PostgresRepo() : memory;
}

/** Every saved task view, by name. */
export async function taskViewsFor(): Promise<TaskView[]> {
  return repo().all();
}

export async function getTaskView(id: string): Promise<TaskView | null> {
  return repo().get(id);
}

/** Create or update a task view; a deleted view's ID saves it live again. */
export async function saveTaskView(view: TaskView): Promise<TaskView> {
  await repo().put(view);
  return view;
}

/**
 * What POST /api/views does for a task view: update the view the ID names, or
 * create a new one under an ID the server makes (an ID from another kind is
 * never reused).
 */
export async function submitTaskView(draft: TaskViewDraft): Promise<TaskView> {
  const known = draft.id ? ((await repo().get(draft.id)) ?? (await repo().getDeleted(draft.id))) : null;
  const view: TaskView = { ...draft, kind: "tasks", id: known ? known.id : newViewId() };
  await repo().put(view);
  return view;
}

export async function deleteTaskView(id: string): Promise<boolean> {
  if (!(await repo().get(id))) return false;
  await repo().remove(id);
  return true;
}

/**
 * Test helper: reset the in-memory task view store. `restart` keeps the stored
 * views, forgetting only per-process state, like a cold start.
 */
export function __resetTaskViews(opts: { restart?: boolean } = {}): void {
  if (opts.restart) return;
  memory.map.clear();
  memory.deleted.clear();
}
