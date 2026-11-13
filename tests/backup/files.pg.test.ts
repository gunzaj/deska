// SPEC §4.7 / D8: automatic backup files, rotation, the pre-migration backup.
import { chmodSync, copyFileSync, mkdtempSync, utimesSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { backupBeforeMigration, backupDir, backupHealth, backupIfDue, backupsToKeep, listBackups, readBackup, rotateBackups, setMirrorDir, syncMirror, writeBackup, type BackupInfo } from "@/lib/backup/files";
import { resetEverything } from "@/lib/backup/local-data";
import { setLocalToken } from "@/lib/github/local-token";

// Built at run time so no token-shaped literal sits in the repo (the leak guard).
const TOKEN = ["github", "pat", "11AAAAAAA0abcdefghijklmnopqrstuvwxyz0123456789"].join("_");
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
  setLocalToken(null, "launch");
  rmSync(dir, { recursive: true, force: true });
  chmodSync(mirror, 0o700);
  rmSync(mirror, { recursive: true, force: true });
});

describe("backup files", () => {
  it("writes a readable JSON file, owner-only, named by time and reason", async () => {
    const info = await writeBackup("daily", day(0));
    expect(info).toMatchObject({ name: "deska-backup-20261101T090000Z-daily.json", reason: "daily", createdAt: "2026-11-01T09:00:00.000Z" });
    expect(statSync(path.join(dir, info!.name)).mode & 0o777).toBe(0o600);
    expect(readBackup(info!.name).tables.tasks!.map((r) => r.title)).toEqual(["Keep me"]);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("rotation keeps every backup of the last 14 days, then one a week", async () => {
    // One a day for 30 days; "now" is the last one.
    for (let i = 0; i < 30; i++) await writeBackup("daily", day(i));
    const left = listBackups();
    const ageDays = (b: { createdAt: string }) => Math.round((day(29).getTime() - new Date(b.createdAt).getTime()) / 86_400_000);
    // Days 0..14 back (the cutoff is inclusive) are all there.
    for (let a = 0; a <= 14; a++) expect(left.map(ageDays)).toContain(a);
    // Older ones are thinned to one per calendar week.
    const older = left.filter((b) => ageDays(b) > 14);
    expect(older.length).toBeGreaterThan(0);
    expect(older.length).toBeLessThanOrEqual(3);
    expect(left[0]!.createdAt).toBe(day(29).toISOString());
    expect(rotateBackups(dir, day(29))).toEqual([]);
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

const info = (iso: string, reason: BackupInfo["reason"] = "daily"): BackupInfo => ({ name: `deska-backup-${iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${reason}.json`, createdAt: iso, reason, bytes: 1 });

describe("retention (pure)", () => {
  const now = new Date("2026-11-30T12:00:00Z");

  it("keeps all of the last 14 days, whatever the reason, and several in a day", () => {
    const items = [info("2026-11-30T09:00:00Z"), info("2026-11-30T10:00:00Z", "manual"), info("2026-11-17T13:00:00Z", "migration"), info("2026-11-16T13:00:00Z")];
    expect([...backupsToKeep(items, now)].sort()).toEqual(items.map((i) => i.name).sort());
  });

  it("then keeps the newest of each calendar week for 8 weeks, and drops the rest", () => {
    // Mon 2026-11-09 is week A (two files), Mon 2026-11-02 is week B, Sep 21 is past 14 days + 8 weeks.
    const wedA = info("2026-11-11T09:00:00Z");
    const monA = info("2026-11-09T09:00:00Z");
    const friB = info("2026-11-06T09:00:00Z");
    const monB = info("2026-11-02T09:00:00Z");
    const tooOld = info("2026-09-21T09:00:00Z");
    const keep = backupsToKeep([monA, wedA, friB, monB, tooOld, info("2026-11-30T09:00:00Z")], now);
    expect(keep.has(wedA.name)).toBe(true);
    expect(keep.has(monA.name)).toBe(false);
    expect(keep.has(friB.name)).toBe(true);
    expect(keep.has(monB.name)).toBe(false);
    expect(keep.has(tooOld.name)).toBe(false);
  });

  it("never drops the newest backup, however old", () => {
    const only = info("2025-01-01T09:00:00Z");
    expect([...backupsToKeep([only, info("2024-01-01T09:00:00Z")], now)]).toEqual([only.name]);
  });
});

describe("second folder", () => {
  it("copies each backup, owner-only, with no temp files left", async () => {
    setMirrorDir(mirror);
    const a = await writeBackup("daily", day(0));
    const b = await writeBackup("manual", day(1));
    expect(listBackups(mirror).map((x) => x.name).sort()).toEqual([a!.name, b!.name].sort());
    expect(statSync(path.join(mirror, a!.name)).mode & 0o777).toBe(0o600);
    expect(readdirSync(mirror).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(readFileSync(path.join(mirror, a!.name), "utf8")).toBe(readFileSync(path.join(dir, a!.name), "utf8"));
    expect(backupHealth()).toMatchObject({ mirrorDir: mirror, mirrorError: null, missing: 0, mirrored: 2 });
  });

  it("applies the same retention there, and leaves other files alone", async () => {
    setMirrorDir(mirror);
    writeFileSync(path.join(mirror, "holiday.jpg"), "x");
    for (let i = 0; i < 30; i++) await writeBackup("daily", day(i));
    expect(listBackups(mirror).map((b) => b.name)).toEqual(listBackups().map((b) => b.name));
    expect(readdirSync(mirror)).toContain("holiday.jpg");
  });

  it("catches up when the folder comes back, and reports it while it is away", async () => {
    setMirrorDir(path.join(mirror, "gone"));
    await writeBackup("daily", day(0));
    expect(backupHealth().mirrorError).toMatch(/not available/);
    expect(backupHealth().missing).toBe(1);
    // The local backup was still written.
    expect(listBackups()).toHaveLength(1);
    setMirrorDir(mirror);
    expect(syncMirror(day(0))).toMatchObject({ error: null });
    expect(listBackups(mirror)).toHaveLength(1);
    expect(backupHealth()).toMatchObject({ mirrorError: null, missing: 0 });
  });

  it("does not create the folder: an unplugged drive is not recreated on the startup disk", async () => {
    const missing = path.join(mirror, "Volumes", "Backup");
    setMirrorDir(missing);
    await writeBackup("daily", day(0));
    expect(readdirSync(mirror)).toEqual([]);
  });

  it("refuses the local backup folder as the second one", async () => {
    setMirrorDir(dir);
    await writeBackup("daily", day(0));
    expect(backupHealth().mirrorError).toMatch(/different folder/);
    expect(listBackups(dir)).toHaveLength(1);
  });

  it("a folder that cannot be written is reported, not thrown", async () => {
    setMirrorDir(mirror);
    chmodSync(mirror, 0o500);
    const out = await writeBackup("daily", day(0));
    expect(out).not.toBeNull();
    if (process.getuid?.() !== 0) expect(backupHealth().mirrorError).toBeTruthy();
  });

  it("the daily check copies what is missing even when no new backup is due", async () => {
    await backupIfDue(day(0));
    setMirrorDir(mirror);
    expect(await backupIfDue(new Date(day(0).getTime() + 3_600_000))).toBeNull();
    expect(listBackups(mirror)).toHaveLength(1);
  });

  it("a relative path is ignored", () => {
    setMirrorDir("relative/dir");
    expect(backupHealth().mirrorDir).toBeNull();
  });
});

describe("backup health", () => {
  it("records a failed backup and clears it on the next good one", async () => {
    const real = process.env.DESKA_BACKUP_DIR!;
    writeFileSync(path.join(real, "plain-file"), "x");
    process.env.DESKA_BACKUP_DIR = path.join(real, "plain-file", "backups"); // a folder under a file cannot be made
    await expect(writeBackup("daily", day(0))).rejects.toBeTruthy();
    expect(backupHealth().error).toBeTruthy();
    process.env.DESKA_BACKUP_DIR = real;
    await writeBackup("daily", day(1));
    expect(backupHealth().error).toBeNull();
  });
});

describe("second folder shared by two Macs (B-4)", () => {
  it("does not copy back a weekly backup the other Mac's newer one displaced", async () => {
    const now = new Date("2026-11-13T09:00:00Z");
    // This Mac's Monday backup; the other Mac's Wednesday of the same week is already in the shared folder.
    const mine = await writeBackup("daily", new Date("2026-09-14T09:00:00Z"));
    const theirs = "deska-backup-20260916T090000Z-daily.json";
    copyFileSync(path.join(dir, mine!.name), path.join(mirror, theirs));
    setMirrorDir(mirror);
    await writeBackup("daily", now);
    expect(listBackups(mirror).map((b) => b.name)).toContain(theirs);
    expect(listBackups(mirror).map((b) => b.name)).not.toContain(mine!.name);
    // Stable: the next hourly check neither copies nor deletes anything, and Settings does not report it missing.
    expect(syncMirror(now)).toMatchObject({ copied: [], error: null });
    expect(listBackups(mirror).map((b) => b.name)).toContain(theirs);
    expect(backupHealth().missing).toBe(0);
  });
});

describe("backup durability (B-5)", () => {
  it("rotation removes stale temp files and leaves fresh ones", async () => {
    await writeBackup("daily", day(0));
    const stale = path.join(dir, ".deska-backup-20260101T000000Z-daily.json.tmp");
    const fresh = path.join(dir, ".deska-backup-20260102T000000Z-daily.json.uuid.tmp");
    writeFileSync(stale, "{");
    writeFileSync(fresh, "{");
    const old = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(stale, old, old);
    rotateBackups(dir, day(0));
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([path.basename(fresh)]);
  });

  it("an empty newest file does not suppress the next daily backup", async () => {
    await writeBackup("daily", day(0));
    writeFileSync(path.join(dir, "deska-backup-20261102T080000Z-daily.json"), "");
    const made = await backupIfDue(new Date("2026-11-02T10:00:00Z"));
    expect(made?.name).toBe("deska-backup-20261102T100000Z-daily.json");
    expect(readBackup(made!.name).kind).toBe("deska-backup");
  });
});
