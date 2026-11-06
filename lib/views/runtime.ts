import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { dbDir, getDb } from "@/db";
import { syncState, views as viewsTable } from "@/db/schema";
import { canEditView, newViewId, SYSTEM_OWNER } from "./ids";
import { seedViews, trySeedViews } from "./seeds";
import { visibleViews } from "./engine";
import { viewSchema, type View } from "./view";
import { getStore } from "../store";

/**
 * Saved views — the one thing GitHub does not hold (SPEC §1).
 *
 * With DESKA_DB_DIR they live in the `views` table, so they survive restarts
 * and every serverless instance sees the same set. Previously they lived only
 * in a module-level Map: every deploy or cold start silently dropped all saved
 * views, and two Vercel instances showed different ones.
 *
 * Without a database (dev fixtures, tests) the Map is the store.
 */
interface ViewRepo {
  all(): Promise<View[]>;
  get(id: string): Promise<View | null>;
  put(view: View): Promise<void>;
  /** Insert unless the ID exists: seeding must never overwrite a view. */
  add(view: View): Promise<void>;
  /** Soft delete (U1): the row stays so the owner can undo, until S8 purges it. */
  remove(id: string): Promise<void>;
  /** A soft-deleted view, or null. */
  getDeleted(id: string): Promise<View | null>;
  restore(id: string): Promise<void>;
  /** Whether the seed views were ever written, remembered across restarts. */
  isSeeded(): Promise<boolean>;
  markSeeded(): Promise<void>;
}

class MemoryRepo implements ViewRepo {
  map = new Map<string, View>();
  deleted = new Map<string, View>();
  seeded = false;
  async all() {
    return [...this.map.values()];
  }
  async get(id: string) {
    return this.map.get(id) ?? null;
  }
  async put(v: View) {
    this.map.set(v.id, v);
  }
  async add(v: View) {
    if (!this.map.has(v.id) && !this.deleted.has(v.id)) this.map.set(v.id, v);
  }
  async remove(id: string) {
    const v = this.map.get(id);
    if (v) this.deleted.set(id, v);
    this.map.delete(id);
  }
  async getDeleted(id: string) {
    return this.deleted.get(id) ?? null;
  }
  async restore(id: string) {
    const v = this.deleted.get(id);
    if (!v) return;
    this.deleted.delete(id);
    this.map.set(id, v);
  }
  async isSeeded() {
    return this.seeded;
  }
  async markSeeded() {
    this.seeded = true;
  }
}

const SEEDED_KEY = "views.seeded";

class PostgresRepo implements ViewRepo {
  private parse(row: { definitionJson: unknown }): View | null {
    const parsed = viewSchema.safeParse(row.definitionJson);
    return parsed.success ? parsed.data : null;
  }
  async all() {
    const rows = await getDb().select().from(viewsTable).where(isNull(viewsTable.deletedAt)).orderBy(asc(viewsTable.position), asc(viewsTable.name));
    return rows.map((r) => this.parse(r)).filter((v): v is View => v != null);
  }
  async get(id: string) {
    const row = await getDb().query.views.findFirst({ where: and(eq(viewsTable.id, id), isNull(viewsTable.deletedAt)) });
    return row ? this.parse(row) : null;
  }
  async getDeleted(id: string) {
    const row = await getDb().query.views.findFirst({ where: and(eq(viewsTable.id, id), isNotNull(viewsTable.deletedAt)) });
    return row ? this.parse(row) : null;
  }
  async restore(id: string) {
    await getDb().update(viewsTable).set({ deletedAt: null }).where(eq(viewsTable.id, id));
  }
  private values(v: View) {
    return {
      id: v.id,
      ownerId: v.ownerId,
      name: v.name,
      visibility: v.visibility,
      definitionJson: v,
      updatedAt: new Date(),
    };
  }
  async put(v: View) {
    // Saving a view (also one that was deleted) makes it live again.
    const values = { ...this.values(v), deletedAt: null };
    await getDb()
      .insert(viewsTable)
      .values(values)
      .onConflictDoUpdate({ target: viewsTable.id, set: values });
  }
  async add(v: View) {
    await getDb().insert(viewsTable).values(this.values(v)).onConflictDoNothing({ target: viewsTable.id });
  }
  async remove(id: string) {
    await getDb().update(viewsTable).set({ deletedAt: new Date() }).where(eq(viewsTable.id, id));
  }
  async isSeeded() {
    const row = await getDb().query.syncState.findFirst({ where: eq(syncState.key, SEEDED_KEY) });
    return row != null;
  }
  async markSeeded() {
    await getDb()
      .insert(syncState)
      .values({ key: SEEDED_KEY, value: new Date().toISOString() })
      .onConflictDoNothing({ target: syncState.key });
  }
}

// On globalThis: in `next dev` each route gets its own copy of this module, and
// a module-level store gave /api/views, /api/views/restore and the watch
// coverage three different view sets (an undone delete failed). Tasks, watches
// and snoozes already live on globalThis (v5 2.10).
const g = globalThis as { __deskaViews?: MemoryRepo };
const memory = (g.__deskaViews ??= new MemoryRepo());
// Per-process shortcut; the durable flag lives in the repo.
let seeded = false;

function repo(): ViewRepo {
  return dbDir() ? new PostgresRepo() : memory;
}

/**
 * Seed the SPEC §4 views once. Seeding needs discovered option IDs; if the
 * cache has not been synced yet (no project fields) we serve name-free
 * fallbacks *without* persisting or marking the seed done, so a visit before
 * the first sync cannot lock in the fallbacks. (trySeedViews never returns an
 * empty list, so the old `!full.length` check never fired: an early visit
 * persisted the seeds without the Core board.)
 *
 * "Seeded" is persisted, not just a module flag: every cold start used to
 * re-create any seed view its owner had deleted. Seeds are inserted, never
 * upserted, so two first visitors racing cannot overwrite each other.
 */
async function ensureSeeded(): Promise<View[]> {
  const r = repo();
  if (seeded) return r.all();
  if (await r.isSeeded()) {
    seeded = true;
    return r.all();
  }
  const existing = await r.all();
  const have = new Set(existing.map((v) => v.id));
  const store = await getStore();
  if (store.fields.size === 0) {
    return [...existing, ...seedViews(SYSTEM_OWNER).filter((v) => !have.has(v.id))];
  }
  for (const v of trySeedViews(store, SYSTEM_OWNER)) if (!have.has(v.id)) await r.add(v);
  await r.markSeeded();
  seeded = true;
  return r.all();
}

/** Every view the viewer may see: their own plus everyone's shared views. */
export async function viewsFor(ownerId: string): Promise<View[]> {
  // GitHub logins are case-insensitive: normalize, like tasks and watches do.
  const who = ownerId.toLowerCase();
  return visibleViews(await ensureSeeded(), who);
}

export async function getView(ownerId: string, id: string): Promise<View | null> {
  return (await viewsFor(ownerId)).find((v) => v.id === id) ?? null;
}

/**
 * Create or update a view. Only the owner may change an existing view, shared
 * or not; everyone else can duplicate it (SPEC §14, Q6). The seed views belong
 * to no one (SYSTEM_OWNER) and anyone may change them (Q-B). With org-wide access,
 * letting anyone edit a shared view would let any member rewrite it for all.
 */
export async function saveView(ownerId: string, view: View): Promise<View | null> {
  const who = ownerId.toLowerCase();
  await ensureSeeded();
  const r = repo();
  // A deleted view's ID still belongs to its owner until it is purged.
  const prev = (await r.get(view.id)) ?? (await r.getDeleted(view.id));
  if (prev && !canEditView(prev.ownerId, who)) return null;
  const next: View = { ...view, ownerId: prev?.ownerId ?? who };
  await r.put(next);
  return next;
}

/**
 * What POST /api/views does: update the view the ID names, or create a new one
 * under an ID the server makes. The client chooses no ID for a new view (v5
 * 2.6), so it cannot squat on another user's, or on a seed's.
 */
export async function submitView(ownerId: string, view: View): Promise<View | null> {
  await ensureSeeded();
  const r = repo();
  const known = (await r.get(view.id)) ?? (await r.getDeleted(view.id));
  return saveView(ownerId, known ? view : { ...view, id: newViewId() });
}

export async function duplicateView(ownerId: string, id: string, name: string): Promise<View | null> {
  const who = ownerId.toLowerCase();
  const src = await getView(who, id);
  if (!src) return null;
  const copy: View = { ...src, id: newViewId(), name, ownerId: who, visibility: "personal" };
  await repo().put(copy);
  return copy;
}

export async function deleteView(ownerId: string, id: string): Promise<boolean> {
  const who = ownerId.toLowerCase();
  const r = repo();
  const v = await r.get(id);
  if (!v) return false;
  if (!canEditView(v.ownerId, who)) return false;
  await r.remove(id);
  return true;
}

/** Undo a delete (U1): only the owner, only a deleted view. */
export async function restoreView(ownerId: string, id: string): Promise<View | null> {
  const who = ownerId.toLowerCase();
  const r = repo();
  const v = await r.getDeleted(id);
  if (!v || !canEditView(v.ownerId, who)) return null;
  await r.restore(id);
  return v;
}

export { newViewId };

/**
 * Test helper: reset the in-memory view store. `restart` keeps the stored
 * views and seed flag, forgetting only per-process state, like a cold start.
 */
export function __resetViews(opts: { restart?: boolean } = {}): void {
  seeded = false;
  if (opts.restart) return;
  memory.map.clear();
  memory.deleted.clear();
  memory.seeded = false;
}
