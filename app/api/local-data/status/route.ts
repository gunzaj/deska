import { dbDir } from "@/db";
import { backupDir, listBackups } from "@/lib/backup/files";
import { dbState } from "@/lib/backup/recover";
import { route } from "@/lib/server/route";

export const dynamic = "force-dynamic";

/**
 * Whether the local database opened, and the backups on disk (D8). Public: the
 * desktop shell asks before there is a user, and when the database is broken.
 * Only names, dates and sizes; never data.
 */
export const GET = route({ auth: "public" }, async () => {
  const state = dbState();
  return {
    database: { ok: dbDir() ? state.ok !== false : true, error: state.ok === false ? state.error : null },
    backups: { enabled: !!backupDir(), items: listBackups() },
  };
});
