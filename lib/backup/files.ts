// Automatic backups (SPEC §4.7): JSON files of all local-only data in the
// backups folder next to the database (`DESKA_BACKUP_DIR`, set by the desktop
// shell; ~/Library/Application Support/Deska/backups in the app). One daily,
// one before every migration and one before "Reset everything"; the newest 14
// are kept. Without the variable (tests, dev preview) nothing is written.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { exportLocalData, parseLocalData, schemaVersion, type LocalData } from "./local-data";

export type BackupReason = "daily" | "migration" | "reset" | "manual";

export const KEEP_BACKUPS = 14;
const DAY_MS = 86_400_000;
const NAME = /^deska-backup-(\d{8}T\d{6}Z)-(daily|migration|reset|manual)\.json$/;

export type BackupInfo = { name: string; createdAt: string; reason: BackupReason; bytes: number };

export function backupDir(): string | null {
  const dir = process.env.DESKA_BACKUP_DIR?.trim();
  return dir ? dir : null;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const fromStamp = (s: string) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);

/** Backups, newest first. */
export function listBackups(dir = backupDir()): BackupInfo[] {
  if (!dir || !existsSync(dir)) return [];
  const out: BackupInfo[] = [];
  for (const name of readdirSync(dir)) {
    const m = NAME.exec(name);
    if (!m) continue;
    out.push({ name, createdAt: fromStamp(m[1]!).toISOString(), reason: m[2] as BackupReason, bytes: statSync(path.join(dir, name)).size });
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** Keep the newest `keep` backups; older ones go. */
export function rotateBackups(dir: string, keep = KEEP_BACKUPS): string[] {
  const old = listBackups(dir).slice(keep);
  for (const b of old) rmSync(path.join(dir, b.name), { force: true });
  return old.map((b) => b.name);
}

/** Writes one backup (atomically: a half-written file is never listed) and rotates. Null when backups are off. */
export async function writeBackup(reason: BackupReason, now = new Date(), data?: LocalData): Promise<BackupInfo | null> {
  const dir = backupDir();
  if (!dir) return null;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const doc = data ?? (await exportLocalData(now));
  // Two backups in one second (a migration right after a daily one) get distinct names.
  let when = now;
  while (existsSync(path.join(dir, `deska-backup-${stamp(when)}-${reason}.json`))) when = new Date(when.getTime() + 1000);
  const name = `deska-backup-${stamp(when)}-${reason}.json`;
  const tmp = path.join(dir, `.${name}.tmp`);
  writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 });
  renameSync(tmp, path.join(dir, name));
  rotateBackups(dir);
  return { name, createdAt: when.toISOString(), reason, bytes: statSync(path.join(dir, name)).size };
}

/** Reads and checks a backup file by name (a bare file name in the backups folder, nothing else). */
export function readBackup(name: string): LocalData {
  const dir = backupDir();
  if (!dir || !NAME.test(name)) throw new Error("no such backup");
  return parseLocalData(JSON.parse(readFileSync(path.join(dir, name), "utf8")));
}

/** Backups are taken at most this often by the daily check. */
export async function backupIfDue(now = new Date()): Promise<BackupInfo | null> {
  if (!backupDir()) return null;
  const newest = listBackups()[0];
  if (newest && now.getTime() - new Date(newest.createdAt).getTime() < DAY_MS) return null;
  return writeBackup("daily", now);
}

/**
 * Before pending migrations run on a database that has data: a backup of what
 * is there. A fresh database (no migration applied yet) has nothing to lose.
 * A failed backup is logged and the migration goes on: a database that cannot
 * be read is the recovery flow's job, not this one's.
 */
export async function backupBeforeMigration(now = new Date()): Promise<BackupInfo | null> {
  if (!backupDir()) return null;
  let applied = 0;
  try {
    const res = await getDb().execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    applied = Number((res.rows[0] as { n: number }).n);
  } catch {
    return null;
  }
  if (applied === 0 || applied >= schemaVersion()) return null;
  try {
    return await writeBackup("migration", now);
  } catch (e) {
    console.error(`deska: the backup before the migration failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
