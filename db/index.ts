// The local database: embedded Postgres (PGlite, WASM) via Drizzle (SPEC §2.1).
//
// One PGlite instance per process, on `globalThis`: Next.js compiles server
// code into several bundles (pages, route handlers, instrumentation), and two
// module copies opening the same data directory would corrupt it. PGlite is a
// single connection; its own mutex serializes queries and transactions.
import { existsSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export type Db = PgliteDatabase<typeof schema>;

type Instance = { dir: string; pg: PGlite; db: Db; migrated?: Promise<void> };
type QueryListener = (sql: string) => void;
const KEY = Symbol.for("deska.db");
const LISTENERS = Symbol.for("deska.db.queryListeners");
const g = globalThis as unknown as { [KEY]?: Instance; [LISTENERS]?: Set<QueryListener> };

function listeners(): Set<QueryListener> {
  return (g[LISTENERS] ??= new Set());
}

/**
 * Calls `fn` with every SQL statement Drizzle sends (transactions included)
 * until the returned function is called. Tests use it to assert what a sync
 * writes.
 */
export function onQuery(fn: QueryListener): () => void {
  listeners().add(fn);
  return () => listeners().delete(fn);
}

/**
 * Where the database lives (`DESKA_DB_DIR`): a directory, or `memory://` for a
 * throwaway in-memory database (tests). Null: no database, the app serves the
 * demo fixtures from memory (dev preview, mocked e2e).
 */
export function dbDir(): string | null {
  const dir = process.env.DESKA_DB_DIR;
  return dir && dir.trim() ? dir.trim() : null;
}

function instance(): Instance {
  const dir = dbDir();
  if (!dir) throw new Error("DESKA_DB_DIR is not configured");
  const cur = g[KEY];
  if (cur && cur.dir === dir) return cur;
  if (cur) throw new Error("the database directory changed while it was open; call closeDb() first");
  const pg = new PGlite(dir, { extensions: { pg_trgm } });
  const logger = { logQuery: (q: string) => listeners().forEach((l) => l(q)) };
  const created: Instance = { dir, pg, db: drizzle(pg, { schema, logger }) };
  g[KEY] = created;
  return created;
}

export function getDb(): Db {
  return instance().db;
}

/** The raw PGlite client, for code that needs plain SQL outside Drizzle. */
export function getPglite(): PGlite {
  return instance().pg;
}

/**
 * The migrations folder: `DESKA_MIGRATIONS_DIR`, else `drizzle/` in the working
 * directory (the repo in dev and tests, the server folder in the desktop app).
 */
export function migrationsDir(): string {
  const dir = process.env.DESKA_MIGRATIONS_DIR?.trim() || path.join(process.cwd(), "drizzle");
  if (!existsSync(path.join(dir, "meta", "_journal.json"))) throw new Error(`no migrations found in ${dir}`);
  return dir;
}

/**
 * Apply pending migrations, once per process (later calls share the first).
 * The baseline creates `pg_trgm`, which PGlite ships as a bundled extension.
 */
export function ensureMigrated(): Promise<void> {
  const inst = instance();
  if (!inst.migrated) {
    const p = migrate(inst.db, { migrationsFolder: migrationsDir() });
    // A failed run is not remembered: the next call tries again.
    p.catch(() => {
      if (inst.migrated === p) inst.migrated = undefined;
    });
    inst.migrated = p;
  }
  return inst.migrated;
}

export async function closeDb(): Promise<void> {
  const cur = g[KEY];
  g[KEY] = undefined;
  if (cur && !cur.pg.closed) await cur.pg.close();
}
