// SPEC §4.7 / D8: a database that fails to open offers a restore from the latest backup, and restores.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { listBackups, writeBackup } from "@/lib/backup/files";
import { LocalDataError } from "@/lib/backup/local-data";
import { dbState, recoverDatabase } from "@/lib/backup/recover";
import { openDatabase } from "@/lib/desktop/startup";

// Lets one test make the migration of the fresh database fail; everything else runs for real.
const failMigration = vi.hoisted(() => ({ next: false }));
vi.mock("@/db", async (orig) => {
  const actual = await orig<typeof import("@/db")>();
  return {
    ...actual,
    ensureMigrated: () => {
      if (failMigration.next) {
        failMigration.next = false;
        return Promise.reject(new Error("disk full"));
      }
      return actual.ensureMigrated();
    },
  };
});

const root = mkdtempSync(path.join(tmpdir(), "deska-recover-"));
afterAll(async () => {
  await closeDb();
  delete process.env.DESKA_BACKUP_DIR;
  rmSync(root, { recursive: true, force: true });
});

const titles = async () => ((await getDb().execute(sql`SELECT title FROM tasks ORDER BY title`)).rows as { title: string }[]).map((r) => r.title);

async function useDisk(name: string) {
  await closeDb();
  process.env.DESKA_DB_DIR = path.join(root, name, "db");
  mkdirSync(process.env.DESKA_DB_DIR, { recursive: true }); // the desktop shell creates it
  process.env.DESKA_BACKUP_DIR = path.join(root, name, "backups");
}

// Each test opens several on-disk databases (WASM start-up): slow on a CI runner.
vi.setConfig({ testTimeout: 60_000 });

describe("recovery", () => {
  it("a corrupted database is reported, restored from the latest backup, and kept aside", async () => {
    await useDisk("a");
    expect(await openDatabase()).toBe(true);
    await getDb().execute(sql`INSERT INTO tasks (creator_login, title) VALUES ('local', 'Survives')`);
    await writeBackup("daily", new Date("2026-11-01T09:00:00Z"));
    await getDb().execute(sql`INSERT INTO tasks (creator_login, title) VALUES ('local', 'Newer')`);
    await writeBackup("daily", new Date("2026-11-02T09:00:00Z"));
    await closeDb();

    // Damage the database folder.
    const dir = process.env.DESKA_DB_DIR!;
    writeFileSync(path.join(dir, "PG_VERSION"), "garbage");
    writeFileSync(path.join(dir, "global", "pg_control"), Buffer.alloc(8192, 7));

    expect(await openDatabase()).toBe(false);
    expect(dbState()).toMatchObject({ ok: false });
    expect(dbState().error).toBeTruthy();

    let started = 0;
    const res = await recoverDatabase("restore", () => void started++);
    expect(res.restored).toMatch(/20261102T090000Z-daily/);
    expect(started).toBe(1);
    expect(dbState()).toEqual({ ok: true, error: null });
    expect(await titles()).toEqual(["Newer", "Survives"]);
    // The damaged folder is moved aside, not deleted.
    expect(res.movedTo && existsSync(res.movedTo)).toBe(true);
    expect(readdirSync(path.dirname(dir)).some((n) => n.startsWith("db.damaged-"))).toBe(true);
    // Nothing to recover once it opened.
    await expect(recoverDatabase("restore")).rejects.toThrow(LocalDataError);
  });

  it("skips a backup that cannot be read and uses the next older one", async () => {
    await useDisk("b");
    expect(await openDatabase()).toBe(true);
    await getDb().execute(sql`INSERT INTO tasks (creator_login, title) VALUES ('local', 'Older but fine')`);
    await writeBackup("daily", new Date("2026-11-01T09:00:00Z"));
    const bad = await writeBackup("daily", new Date("2026-11-02T09:00:00Z"));
    writeFileSync(path.join(process.env.DESKA_BACKUP_DIR!, bad!.name), "{ not json");
    await closeDb();
    const dir = process.env.DESKA_DB_DIR!;
    writeFileSync(path.join(dir, "PG_VERSION"), "garbage");
    writeFileSync(path.join(dir, "global", "pg_control"), Buffer.alloc(8192, 7));

    expect(await openDatabase()).toBe(false);
    const res = await recoverDatabase("restore");
    expect(res.skipped).toEqual([bad!.name]);
    expect(res.restored).toMatch(/20261101T090000Z/);
    expect(await titles()).toEqual(["Older but fine"]);
  });

  it("with no backup, restore leaves an empty database and says so; 'fresh' starts empty", async () => {
    await useDisk("c");
    expect(await openDatabase()).toBe(true);
    await closeDb();
    const dir = process.env.DESKA_DB_DIR!;
    writeFileSync(path.join(dir, "PG_VERSION"), "garbage");
    writeFileSync(path.join(dir, "global", "pg_control"), Buffer.alloc(8192, 7));
    expect(listBackups()).toEqual([]);

    expect(await openDatabase()).toBe(false);
    const res = await recoverDatabase("restore");
    expect(res.restored).toBeNull();
    expect(await titles()).toEqual([]);
  });

  it("B-2: when the fresh database cannot be set up, the original folder is put back and the failure is still reported", async () => {
    await useDisk("d");
    expect(await openDatabase()).toBe(true);
    await getDb().execute(sql`INSERT INTO tasks (creator_login, title) VALUES ('local', 'Real data')`);
    await writeBackup("daily", new Date("2026-11-01T09:00:00Z"));
    await closeDb();
    const dir = process.env.DESKA_DB_DIR!;
    writeFileSync(path.join(dir, "PG_VERSION"), "garbage");
    writeFileSync(path.join(dir, "global", "pg_control"), Buffer.alloc(8192, 7));
    expect(await openDatabase()).toBe(false);
    expect(dbState().error).toMatch(/^Database could not open/);

    failMigration.next = true;
    await expect(recoverDatabase("restore")).rejects.toThrow(LocalDataError);
    // The damaged folder is back where it was, nothing is left aside, and the app still reports the failure.
    expect(readFileSync(path.join(dir, "PG_VERSION"), "utf8")).toBe("garbage");
    expect(readdirSync(path.dirname(dir)).filter((n) => n.startsWith("db.damaged-"))).toEqual([]);
    expect(dbState()).toMatchObject({ ok: false });
    expect(dbState().error).toContain("disk full");

    // A later attempt works.
    const res = await recoverDatabase("restore");
    expect(res.restored).toMatch(/20261101T090000Z/);
    expect(await titles()).toEqual(["Real data"]);
  });
});
