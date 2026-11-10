// SPEC §4.7: the backups folder and the second folder under concurrent change.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { backupHealth, listBackups, setMirrorDir, syncMirror, writeBackup } from "@/lib/backup/files";
import { resetEverything } from "@/lib/backup/local-data";

const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n, 9, 0, 0));
let dir: string;
let mirror: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "deska-backups-"));
  mirror = mkdtempSync(path.join(tmpdir(), "deska-mirror-"));
  process.env.DESKA_BACKUP_DIR = dir;
  await resetEverything();
  await getDb().execute(sql`INSERT INTO tasks (creator_login, title) VALUES ('local', 'Keep me')`);
});
afterEach(() => {
  delete process.env.DESKA_BACKUP_DIR;
  setMirrorDir(null);
  rmSync(dir, { recursive: true, force: true });
  rmSync(mirror, { recursive: true, force: true });
});

describe("listing while files go away", () => {
  it("skips a backup that vanished between listing and stat", async () => {
    await writeBackup("daily", day(0));
    // Listed by readdir, gone for stat: what a rotation running at the same time leaves.
    symlinkSync(path.join(dir, "nowhere"), path.join(dir, "deska-backup-20261102T090000Z-daily.json"));
    expect(listBackups().map((b) => b.name)).toEqual(["deska-backup-20261101T090000Z-daily.json"]);
  });
});

describe("second folder", () => {
  it("each copy uses a temp file of its own, so a run in progress does not break another", async () => {
    const info = await writeBackup("daily", day(0));
    setMirrorDir(mirror);
    // Another run's temp file, mid-copy, under the old shared name.
    mkdirSync(path.join(mirror, `.${info!.name}.tmp`));
    expect(syncMirror(day(0))).toMatchObject({ error: null, copied: [info!.name] });
    expect(backupHealth().mirrorError).toBeNull();
    expect(readdirSync(mirror).filter((f) => f.endsWith(".tmp"))).toEqual([`.${info!.name}.tmp`]);
  });

  it("clearing the folder the way the desktop shell does drops its old error", async () => {
    const slot = globalThis as Record<symbol, unknown>;
    slot[Symbol.for("deska.backupMirror")] = path.join(mirror, "gone");
    await writeBackup("daily", day(0));
    expect(backupHealth().mirrorError).toMatch(/not available/);
    // desktop/server-entry.ts sets the slot directly on a `backup-mirror` message.
    slot[Symbol.for("deska.backupMirror")] = undefined;
    expect(backupHealth()).toMatchObject({ mirrorDir: null, mirrorError: null, mirrorCheckedAt: null });
  });
});
