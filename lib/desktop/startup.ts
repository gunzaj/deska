// What the desktop server does once it is up (instrumentation-node.ts, and
// again after a database recovery): open the database, then run the sync, the
// daily backup check and the reminder loop.
import { sql } from "drizzle-orm";
import { dbDir, getDb } from "@/db";
import { prepareDatabase } from "../db-bootstrap";
import { backupDir, backupIfDue, syncMirror } from "../backup/files";
import { setDbState } from "../backup/recover";
import { startOutboxWorker } from "../outbox/worker-loop";
import { syncService } from "../sync/service";
import { startReminderService } from "./reminders";

const CHECK_EVERY_MS = 60 * 60 * 1000;
const SCHEDULE = Symbol.for("deska.backupSchedule");
// desktop/server-entry.ts calls this when the second backup folder changes.
const MIRROR_SYNC = Symbol.for("deska.backupMirrorSync");

/** Opens (and migrates) the database and records whether that worked. */
export async function openDatabase(): Promise<boolean> {
  let step = "could not open";
  try {
    // Opening and migrating fail for different reasons (a damaged folder, a full
    // disk, a broken migration); the recovery dialog says which.
    if (dbDir()) await getDb().execute(sql`SELECT 1`);
    step = "migration failed";
    const { seeded } = await prepareDatabase();
    if (seeded) console.log("deska: seeded the sample dataset into an empty database");
    setDbState(true);
    return true;
  } catch (e) {
    // Drizzle wraps the real reason ("PGlite failed to initialize...") as the cause.
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : null;
    const message = `Database ${step}: ${cause ?? (e instanceof Error ? e.message : String(e))}`;
    console.error(`deska: could not prepare the database: ${message}`);
    setDbState(false, message);
    return false;
  }
}

/** A backup now if the newest is a day old, then again whenever the hour check finds it so; each check also copies what the second backup folder lacks. */
function startBackupSchedule(): void {
  const g = globalThis as Record<symbol, unknown>;
  if (!backupDir() || g[SCHEDULE]) return;
  const check = () => backupIfDue().catch((e: unknown) => console.error(`deska: the daily backup failed: ${e instanceof Error ? e.message : String(e)}`));
  void check();
  (g as Record<symbol, unknown>)[MIRROR_SYNC] = () => void syncMirror();
  const timer = setInterval(() => void check(), CHECK_EVERY_MS);
  timer.unref?.();
  g[SCHEDULE] = timer;
}

/**
 * The sync loop (D5), the backup schedule (D8), reminders with the Dock badge
 * (D12) and the outbox worker (W0); all need an open database.
 */
export function startDesktopServices(): void {
  startBackupSchedule();
  startReminderService();
  startOutboxWorker();
  syncService().start();
}
