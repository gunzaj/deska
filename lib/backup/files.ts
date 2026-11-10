// Automatic backups (SPEC §4.7): JSON files of all local-only data in the
// backups folder next to the database (`DESKA_BACKUP_DIR`, set by the desktop
// shell; ~/Library/Application Support/Deska/backups in the app). One daily,
// one before every migration and one before "Reset everything". Retention:
// every backup of the last 14 days, then the newest of each week for 8 weeks.
// Without the variable (tests, dev preview) nothing is written.
//
// A second, optional folder (the "mirror", chosen in Settings and handed over
// by the desktop shell, never stored in the database) gets a copy of every
// backup, so one lost disk does not take the data and its backups together.
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { exportLocalData, parseLocalData, schemaVersion, type LocalData } from "./local-data";

export type BackupReason = "daily" | "migration" | "reset" | "manual";

/** Every backup this young is kept; older ones thin out to one per week. */
export const KEEP_DAILY_DAYS = 14;
/** How many weeks the weekly backups reach back past the daily window. */
export const KEEP_WEEKLY_WEEKS = 8;
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
    let bytes: number;
    try {
      bytes = statSync(path.join(dir, name)).size;
    } catch {
      continue; // deleted since readdir (a rotation running at the same time)
    }
    out.push({ name, createdAt: fromStamp(m[1]!).toISOString(), reason: m[2] as BackupReason, bytes });
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}

const weekOf = (t: number) => Math.floor((t - 4 * DAY_MS) / (7 * DAY_MS)); // weeks start on Monday (1970-01-05)

/**
 * Names to keep (SPEC §4.7): the newest backup always; every backup of the
 * last 14 days; then, for 8 more weeks, the newest of each calendar week.
 */
export function backupsToKeep(items: BackupInfo[], now = new Date()): Set<string> {
  const keep = new Set<string>();
  const dailyFrom = now.getTime() - KEEP_DAILY_DAYS * DAY_MS;
  const weeklyFrom = dailyFrom - KEEP_WEEKLY_WEEKS * 7 * DAY_MS;
  const seenWeeks = new Set<number>();
  // Newest first, so the first one seen in a week is the one that stays.
  for (const b of [...items].sort((x, y) => (x.name < y.name ? 1 : -1))) {
    const t = new Date(b.createdAt).getTime();
    if (keep.size === 0 || t >= dailyFrom) keep.add(b.name);
    else if (t >= weeklyFrom && !seenWeeks.has(weekOf(t))) keep.add(b.name);
    if (t < dailyFrom) seenWeeks.add(weekOf(t));
  }
  return keep;
}

/** Deletes the backups in `dir` that retention no longer wants; returns their names. */
export function rotateBackups(dir: string, now = new Date()): string[] {
  const items = listBackups(dir);
  const keep = backupsToKeep(items, now);
  const gone = items.filter((b) => !keep.has(b.name));
  for (const b of gone) rmSync(path.join(dir, b.name), { force: true });
  return gone.map((b) => b.name);
}

// --- second folder (the mirror) -------------------------------------------

const MIRROR = Symbol.for("deska.backupMirror");
const HEALTH = Symbol.for("deska.backupHealth");

type Health = { error: string | null; failedAt: string | null; mirrorError: string | null; mirrorCheckedAt: string | null };
/** The folder the mirror fields were recorded for; kept out of what Settings sees. */
type HealthSlot = Health & { mirrorFor?: string | null };
const slot = globalThis as Record<symbol, unknown>;

/** The folder backups are also copied to, or null. Set by the desktop shell over IPC (server-entry.ts), nowhere else. */
export function mirrorDir(): string | null {
  const dir = slot[MIRROR];
  return typeof dir === "string" && path.isAbsolute(dir) ? dir : null;
}

/** Called by the desktop shell's message; the folder itself is checked on the next copy. */
export function setMirrorDir(dir: string | null): void {
  slot[MIRROR] = dir && path.isAbsolute(dir) ? dir : undefined;
  health({ mirrorError: null, mirrorCheckedAt: null, mirrorFor: undefined });
}

function health(patch?: Partial<HealthSlot>): Health {
  const h: HealthSlot = { error: null, failedAt: null, mirrorError: null, mirrorCheckedAt: null, ...((slot[HEALTH] as HealthSlot | undefined) ?? {}), ...patch };
  slot[HEALTH] = h;
  // A mirror error belongs to the folder it was recorded for: once the folder
  // changes or is cleared (also when the shell sets the slot directly), it is gone.
  const current = h.mirrorFor === undefined || h.mirrorFor === mirrorDir();
  return { error: h.error, failedAt: h.failedAt, mirrorError: current ? h.mirrorError : null, mirrorCheckedAt: current ? h.mirrorCheckedAt : null };
}

/** What Settings shows about the health of the last backup and of the second folder. */
export function backupHealth(): Health & { mirrorDir: string | null; mirrored: number; missing: number } {
  const dir = mirrorDir();
  const local = listBackups();
  const there = dir ? new Set(listBackups(dir).map((b) => b.name)) : new Set<string>();
  const keep = backupsToKeep(local);
  const wanted = local.filter((b) => keep.has(b.name));
  return { ...health(), mirrorDir: dir, mirrored: wanted.filter((b) => there.has(b.name)).length, missing: dir ? wanted.filter((b) => !there.has(b.name)).length : 0 };
}

/** Records a failed backup so Settings can say so; a good one clears it. */
export function noteBackupResult(error: unknown | null, now = new Date()): void {
  health(error === null ? { error: null, failedAt: null } : { error: error instanceof Error ? error.message : String(error), failedAt: now.toISOString() });
}

/**
 * Copies every backup the second folder lacks (a drive that was unplugged
 * catches up), then applies retention there. Never throws: a failure is
 * recorded for Settings and the local backups are unaffected. The folder must
 * already exist, so an unplugged drive is reported rather than recreated as a
 * plain folder on the startup disk.
 */
export function syncMirror(now = new Date()): { copied: string[]; error: string | null } {
  const to = mirrorDir();
  const from = backupDir();
  if (!to || !from) return { copied: [], error: null };
  const copied: string[] = [];
  try {
    if (path.resolve(to) === path.resolve(from)) throw new Error("The second folder must be a different folder than the local backups.");
    if (!existsSync(to) || !statSync(to).isDirectory()) throw new Error("The second backup folder is not available. Is the drive connected?");
    const there = new Set(listBackups(to).map((b) => b.name));
    for (const b of listBackups(from).reverse()) {
      if (there.has(b.name)) continue;
      // A temp name of its own: two runs at once (a backup and the hourly
      // check) must not rename each other's file away.
      const tmp = path.join(to, `.${b.name}.${randomUUID()}.tmp`);
      try {
        copyFileSync(path.join(from, b.name), tmp);
        renameSync(tmp, path.join(to, b.name));
      } catch (e) {
        rmSync(tmp, { force: true });
        // Rotated away locally since it was listed: nothing to copy.
        if (!existsSync(path.join(from, b.name))) continue;
        throw e;
      }
      copied.push(b.name);
    }
    rotateBackups(to, now);
    health({ mirrorError: null, mirrorCheckedAt: now.toISOString(), mirrorFor: to });
    return { copied, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    health({ mirrorError: message, mirrorCheckedAt: now.toISOString(), mirrorFor: to });
    return { copied, error: message };
  }
}

/** Writes one backup (atomically: a half-written file is never listed) and rotates. Null when backups are off. */
export async function writeBackup(reason: BackupReason, now = new Date(), data?: LocalData): Promise<BackupInfo | null> {
  const dir = backupDir();
  if (!dir) return null;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const doc = data ?? (await exportLocalData(now));
    // Two backups in one second (a migration right after a daily one) get distinct names.
    let when = now;
    while (existsSync(path.join(dir, `deska-backup-${stamp(when)}-${reason}.json`))) when = new Date(when.getTime() + 1000);
    const name = `deska-backup-${stamp(when)}-${reason}.json`;
    const tmp = path.join(dir, `.${name}.tmp`);
    writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 });
    renameSync(tmp, path.join(dir, name));
    rotateBackups(dir, now);
    noteBackupResult(null);
    syncMirror(now);
    return { name, createdAt: when.toISOString(), reason, bytes: statSync(path.join(dir, name)).size };
  } catch (e) {
    noteBackupResult(e, now);
    throw e;
  }
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
  if (newest && now.getTime() - new Date(newest.createdAt).getTime() < DAY_MS) {
    syncMirror(now); // not due, but a drive plugged in since the last check catches up
    return null;
  }
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
  // exportLocalData stamps `applied` (appliedSchemaVersion), not this build's count.
  if (applied === 0 || applied >= schemaVersion()) return null;
  try {
    return await writeBackup("migration", now);
  } catch (e) {
    console.error(`deska: the backup before the migration failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
