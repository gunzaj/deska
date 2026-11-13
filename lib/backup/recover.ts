// A database that fails to open (SPEC §4.7): the server notes it here, the
// desktop shell asks before it opens the window, and the user picks "Restore
// from latest backup" (or starts empty). The damaged database folder is moved
// aside, never deleted.
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { closeDb, dbDir, ensureMigrated } from "@/db";
import { resetSettingsCache } from "../settings";
import { invalidateReadCache } from "../store";
import { listBackups, readBackup } from "./files";
import { importLocalData, LocalDataError } from "./local-data";

type DbState = { ok: boolean | null; error: string | null };
const STATE = Symbol.for("deska.dbState");

function holder() {
  const g = globalThis as Record<symbol, DbState | undefined>;
  return (g[STATE] ??= { ok: null, error: null });
}

/** Whether the database opened (null: not tried yet, or there is none). */
export function dbState(): DbState {
  return { ...holder() };
}

export function setDbState(ok: boolean, error: string | null = null): void {
  Object.assign(holder(), { ok, error: error ? error.slice(0, 300) : null });
}

export type RecoverResult = { restored: string | null; movedTo: string | null; skipped: string[] };

/**
 * Open a fresh database in place of the one that failed. `restore` imports the
 * newest backup that can be read (older ones are tried when a newer one is
 * damaged or from a newer Deska; when none can be read the result says so and
 * the database is empty); `fresh` starts empty. `after` runs once the
 * database is up (the caller starts the sync and the backup schedule).
 */
export async function recoverDatabase(mode: "restore" | "fresh", after: () => void = () => {}): Promise<RecoverResult> {
  const dir = dbDir();
  if (!dir || dir.startsWith("memory://")) throw new LocalDataError("There is no database folder to recover.", 409);
  if (holder().ok !== false) throw new LocalDataError("The database opened fine; there is nothing to recover.", 409);

  try {
    await closeDb();
  } catch {
    // A database that could not open may not close cleanly either.
  }
  let movedTo: string | null = null;
  if (existsSync(dir)) {
    movedTo = `${dir}.damaged-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    renameSync(dir, movedTo);
  }
  try {
    mkdirSync(dir, { recursive: true });
    resetSettingsCache();
    invalidateReadCache();
    await ensureMigrated();
  } catch (e) {
    // The fresh database cannot open either (a failed migration, a full disk):
    // put the original back, or the next launch would open an empty folder
    // without asking and nothing would ever be restored.
    try {
      await closeDb();
    } catch {
      // never opened
    }
    if (movedTo) {
      rmSync(dir, { recursive: true, force: true });
      renameSync(movedTo, dir);
    }
    const reason = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
    setDbState(false, reason);
    throw new LocalDataError(`Deska could not set up a new database (${reason.slice(0, 200)}). Your original database was put back; nothing was changed.`, 500);
  }

  const result: RecoverResult = { restored: null, movedTo, skipped: [] };
  if (mode === "restore") {
    for (const b of listBackups()) {
      try {
        await importLocalData(readBackup(b.name));
        result.restored = b.name;
        break;
      } catch {
        result.skipped.push(b.name);
      }
    }
  }
  setDbState(true);
  after();
  return result;
}
