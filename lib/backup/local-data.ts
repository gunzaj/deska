// Local data safety (SPEC §4.7): what Deska keeps on this Mac that GitHub does
// not have, as one JSON document, and the operations on it.
//
// - `exportLocalData` reads every local-only table (tasks, projects, labels,
//   views, snoozes, watches, settings, ...) generically with `to_jsonb`, so a
//   backup can be taken from an older schema, right before a migration.
// - `importLocalData` merges a document into the database by primary key and
//   never overwrites a row that exists; it never touches the GitHub cache.
// - `resetGithubCache` and `resetEverything` are the two resets.
//
// Never in a document: the GitHub token. It lives in the OS keychain store and
// in server memory, never in the database; on top of that every string is run
// through the redaction rules (lib/redact.ts), so a token pasted into a task
// title is replaced too.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { dbDir, getDb, migrationsDir } from "@/db";
import { readFileSync } from "node:fs";
import path from "node:path";
import { redactDeep } from "../redact";
import { resetSettingsCache } from "../settings";
import { GENERATION_KEY } from "../sync/generation";
import { withLockedSyncKv } from "../sync/runtime";
import { syncService } from "../sync/service";
import { invalidateReadCache } from "../store";
import { resetViewSeedingFlag } from "../views/runtime";

export const BACKUP_KIND = "deska-backup";
export const BACKUP_VERSION = 1;

/** A table of local-only data, in the order rows can be inserted (parents first). */
type LocalTable = {
  name: string;
  /**
   * Extra condition on an imported row `r`, so a row whose parent was not
   * imported (or is missing from the document) is skipped instead of failing
   * the whole import on a foreign key.
   */
  where?: string;
};

const taskExists = (col: string) => `EXISTS (SELECT 1 FROM tasks t WHERE t.id = r.${col})`;

export const LOCAL_TABLES: readonly LocalTable[] = [
  { name: "app_settings" },
  { name: "views" },
  { name: "task_projects" },
  { name: "task_labels" },
  {
    name: "tasks",
    where: `r.parent_id IS NULL OR EXISTS (SELECT 1 FROM tasks p WHERE p.id = r.parent_id) OR r.parent_id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements($1::jsonb) x)`,
  },
  { name: "task_placements", where: `${taskExists("task_id")} AND (r.project_id IS NULL OR EXISTS (SELECT 1 FROM task_projects p WHERE p.id = r.project_id))` },
  { name: "task_links", where: taskExists("task_id") },
  { name: "task_label_links", where: `${taskExists("task_id")} AND EXISTS (SELECT 1 FROM task_labels l WHERE l.id = r.label_id)` },
  { name: "task_completions", where: `r.task_id IS NULL OR ${taskExists("task_id")}` },
  { name: "task_reminders", where: taskExists("task_id") },
  { name: "task_comments", where: taskExists("task_id") },
  { name: "notifications", where: `r.task_id IS NULL OR ${taskExists("task_id")}` },
  { name: "user_prefs" },
  { name: "triage_snoozes" },
  { name: "watches" },
];

/** The GitHub cache: everything a re-import rebuilds. Local tables hold no foreign key into these. */
const CACHE_TABLES = [
  "issue_field_changes",
  "project_scan_seen",
  "project_item_dims",
  "project_items",
  "issue_labels",
  "issue_assignees",
  "issues",
  "iterations",
  "field_options",
  "project_fields",
  "labels",
  "milestones",
  "issue_types",
  "gh_users",
] as const;

export type LocalData = {
  kind: typeof BACKUP_KIND;
  v: typeof BACKUP_VERSION;
  createdAt: string;
  /** How many migrations the database that wrote this had applied. */
  schemaVersion: number;
  tables: Record<string, Record<string, unknown>[]>;
};

export class LocalDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "LocalDataError";
  }
}

/** The number of migrations this build ships (the newest schema it understands). */
export function schemaVersion(): number {
  const journal = JSON.parse(readFileSync(path.join(migrationsDir(), "meta", "_journal.json"), "utf8")) as { entries: unknown[] };
  return journal.entries.length;
}

function requireDb() {
  if (!dbDir()) throw new LocalDataError("There is no local database in this run.", 409);
  return getDb();
}

/** All local-only data. Tables the database does not have (an older schema) are left out. */
export async function exportLocalData(now = new Date()): Promise<LocalData> {
  const db = requireDb();
  const tables: LocalData["tables"] = {};
  for (const t of LOCAL_TABLES) {
    const exists = await db.execute(sql`SELECT to_regclass(${`public.${t.name}`}) IS NOT NULL AS ok`);
    if (!(exists.rows[0] as { ok: boolean }).ok) continue;
    const res = await db.execute(sql.raw(`SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) AS rows FROM ${t.name} t`));
    tables[t.name] = (res.rows[0] as { rows: Record<string, unknown>[] }).rows;
  }
  return redactDeep({ kind: BACKUP_KIND, v: BACKUP_VERSION, createdAt: now.toISOString(), schemaVersion: schemaVersion(), tables });
}

const documentSchema = z.object({
  kind: z.literal(BACKUP_KIND),
  v: z.literal(BACKUP_VERSION),
  createdAt: z.string().max(40),
  schemaVersion: z.number().int().min(0),
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

const MAX_ROWS = 500_000;

/** Checks a parsed document; throws `LocalDataError` with a message fit for the user. */
export function parseLocalData(value: unknown): LocalData {
  const parsed = documentSchema.safeParse(value);
  if (!parsed.success) throw new LocalDataError("This is not a Deska backup or export file.");
  const doc = parsed.data;
  const known = new Set(LOCAL_TABLES.map((t) => t.name));
  let rows = 0;
  for (const [name, list] of Object.entries(doc.tables)) {
    if (!known.has(name)) throw new LocalDataError(`The file has a table Deska does not know: ${name.slice(0, 40)}.`);
    rows += list.length;
  }
  if (rows > MAX_ROWS) throw new LocalDataError("The file has too many rows.");
  if (doc.schemaVersion > schemaVersion()) throw new LocalDataError("This file was written by a newer version of Deska. Update Deska to import it.");
  return doc as LocalData;
}

export type ImportResult = { tables: Record<string, { rows: number; added: number }>; added: number };

/**
 * Merge a document into the database, by primary key: a row that already
 * exists (or collides with a unique index) is kept as it is. One transaction:
 * a document that fails part-way changes nothing. Views are checked with the
 * strict view schema first; invalid ones are skipped.
 */
export async function importLocalData(value: unknown): Promise<ImportResult> {
  const doc = parseLocalData(value);
  const db = requireDb();
  const { viewSchema } = await import("../views/view");
  const result: ImportResult = { tables: {}, added: 0 };
  try {
    await db.transaction(async (tx) => {
      for (const t of LOCAL_TABLES) {
        let rows = doc.tables[t.name];
        if (!rows?.length) continue;
        if (t.name === "views") rows = rows.filter((r) => viewSchema.safeParse(r.definition_json).success);
        if (!rows.length) continue;
        const json = JSON.stringify(rows);
        const cond = t.where ? `WHERE ${t.where}` : "";
        // `r.*` is the table's own row type: jsonb_populate_recordset reads the
        // columns by name, ignores unknown keys and parses timestamps and uuids.
        // JSON_PARAM is replaced by the document as a bound parameter.
        const template = `INSERT INTO ${t.name} SELECT r.* FROM jsonb_populate_recordset(null::${t.name}, JSON_PARAM) r ${cond.replaceAll("$1::jsonb", "JSON_PARAM")} ON CONFLICT DO NOTHING`;
        const parts = template.split("JSON_PARAM");
        const stmt = sql.join(
          parts.flatMap((p, i) => (i === 0 ? [sql.raw(p)] : [sql`${json}::jsonb`, sql.raw(p)])),
          sql.raw(""),
        );
        const res = (await tx.execute(stmt)) as unknown as { affectedRows?: number };
        const added = res.affectedRows ?? 0;
        result.tables[t.name] = { rows: rows.length, added };
        result.added += added;
      }
    });
  } catch (e) {
    if (e instanceof LocalDataError) throw e;
    throw new LocalDataError("The file could not be imported: its data does not fit this version of Deska. Nothing was changed.");
  }
  afterLocalDataChange();
  return result;
}

/** Forget what in-process caches hold about local data and the GitHub cache. */
function afterLocalDataChange(): void {
  resetSettingsCache();
  invalidateReadCache();
}

/** How long a reset waits for a running sync to give way. */
const SYNC_WAIT_MS = 30_000;

/**
 * Run `fn` with the sync stopped: a running import is aborted after its
 * current page and the sync lock is held while `fn` runs.
 */
async function withSyncPaused<T>(fn: () => Promise<T>): Promise<T> {
  await syncService().interrupt();
  const res = await withLockedSyncKv(fn, { waitMs: SYNC_WAIT_MS, retryMs: 250 });
  if (!res.ran) throw new LocalDataError("A sync is still running. Try again in a moment.", 409);
  return res.value;
}

/** `sync_state` keys that stay through a cache reset: who the token belongs to, the view seeding flag, the ETag generation. */
const KEPT_STATE = `key NOT LIKE 'github.%' AND key NOT IN ('views.seeded', '${GENERATION_KEY}')`;

/**
 * "Reset GitHub cache": drop everything imported from GitHub and the sync
 * cursors, so the next sync is a first import. Tasks, views, snoozes, watches
 * and the settings (project and field mapping) stay.
 */
export async function resetGithubCache(): Promise<void> {
  const db = requireDb();
  await withSyncPaused(async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`TRUNCATE ${CACHE_TABLES.join(", ")} CASCADE`));
      await tx.execute(sql.raw(`DELETE FROM sync_state WHERE ${KEPT_STATE}`));
    });
  });
  afterLocalDataChange();
  void syncService().request("project");
}

/**
 * "Reset everything": the cache, every local table, the settings and the sync
 * state. The GitHub token (in the keychain store, not here) stays until
 * "Disconnect GitHub". The caller takes a backup first.
 */
export async function resetEverything(): Promise<void> {
  const db = requireDb();
  await withSyncPaused(async () => {
    await db.transaction(async (tx) => {
      const res = await tx.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
      const names = (res.rows as { tablename: string }[]).map((r) => `"${r.tablename}"`);
      if (names.length) await tx.execute(sql.raw(`TRUNCATE ${names.join(", ")} RESTART IDENTITY CASCADE`));
    });
  });
  resetViewSeedingFlag();
  afterLocalDataChange();
}
