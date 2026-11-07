// SPEC §4.7 / D8: automatic backup files, rotation, the pre-migration backup.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { backupBeforeMigration, backupDir, backupIfDue, KEEP_BACKUPS, listBackups, readBackup, rotateBackups, writeBackup } from "@/lib/backup/files";
import { resetEverything } from "@/lib/backup/local-data";
import { setLocalToken } from "@/lib/github/local-token";

// Built at run time so no token-shaped literal sits in the repo (the leak guard).
const TOKEN = ["github", "pat", "11AAAAAAA0abcdefghijklmnopqrstuvwxyz0123456789"].join("_");
const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n, 9, 0, 0));
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "deska-backups-"));
  process.env.DESKA_BACKUP_DIR = dir;
  await resetEverything();
  await getDb().execute(sql`INSERT INTO tasks (creator_login, title) VALUES ('local', 'Keep me')`);
});

afterEach(() => {
  delete process.env.DESKA_BACKUP_DIR;
  setLocalToken(null, "launch");
  rmSync(dir, { recursive: true, force: true });
});

describe("backup files", () => {
  it("writes a readable JSON file, owner-only, named by time and reason", async () => {
    const info = await writeBackup("daily", day(0));
    expect(info).toMatchObject({ name: "deska-backup-20261101T090000Z-daily.json", reason: "daily", createdAt: "2026-11-01T09:00:00.000Z" });
    expect(statSync(path.join(dir, info!.name)).mode & 0o777).toBe(0o600);
    expect(readBackup(info!.name).tables.tasks!.map((r) => r.title)).toEqual(["Keep me"]);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("rotation keeps the newest 14", async () => {
    for (let i = 0; i < 17; i++) await writeBackup("daily", day(i));
    const left = listBackups();
    expect(left).toHaveLength(KEEP_BACKUPS);
    expect(left[0]!.createdAt).toBe(day(16).toISOString());
    expect(left.at(-1)!.createdAt).toBe(day(3).toISOString());
    expect(rotateBackups(dir)).toEqual([]);
  });

  it("two backups in the same second get distinct files", async () => {
    const a = await writeBackup("daily", day(0));
    const b = await writeBackup("daily", day(0));
    expect(a!.name).not.toBe(b!.name);
  });

  it("no backup file contains the token", async () => {
    setLocalToken(TOKEN, "user");
    await getDb().execute(sql`INSERT INTO tasks (creator_login, title, description) VALUES ('local', ${`paste ${TOKEN}`}, '')`);
    await writeBackup("daily", day(0));
    await writeBackup("manual", day(1));
    for (const f of readdirSync(dir)) {
      const text = readFileSync(path.join(dir, f), "utf8");
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("github_pat_");
    }
  });

  it("only reads files it wrote: other names and paths are refused", () => {
    writeFileSync(path.join(dir, "notes.json"), "{}");
    expect(() => readBackup("notes.json")).toThrow();
    expect(() => readBackup("../etc/passwd")).toThrow();
    expect(listBackups()).toEqual([]);
  });

  it("is off without a backup folder", async () => {
    delete process.env.DESKA_BACKUP_DIR;
    expect(backupDir()).toBeNull();
    expect(await writeBackup("daily")).toBeNull();
    expect(await backupIfDue()).toBeNull();
    expect(await backupBeforeMigration()).toBeNull();
  });
});

describe("daily", () => {
  it("backs up when the newest is older than a day, not before", async () => {
    expect(await backupIfDue(day(0))).toMatchObject({ reason: "daily" });
    expect(await backupIfDue(new Date(day(0).getTime() + 23 * 3_600_000))).toBeNull();
    expect(await backupIfDue(new Date(day(0).getTime() + 25 * 3_600_000))).toMatchObject({ reason: "daily" });
    expect(listBackups()).toHaveLength(2);
  });
});

describe("before a migration", () => {
  it("backs up when a migration is pending on a database with data", async () => {
    expect(await backupBeforeMigration(day(0))).toBeNull(); // everything applied
    const last = await getDb().execute(sql`SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1`);
    const id = (last.rows[0] as { id: number }).id;
    await getDb().execute(sql`DELETE FROM drizzle.__drizzle_migrations WHERE id = ${id}`);
    try {
      const info = await backupBeforeMigration(day(1));
      expect(info).toMatchObject({ reason: "migration" });
      expect(readBackup(info!.name).tables.tasks).toHaveLength(1);
    } finally {
      await getDb().execute(sql`INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) SELECT ${id}, 'restored', 0 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE id = ${id})`);
    }
  });
});
