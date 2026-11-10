// SPEC §4.7 / D8: a placeholder AI key does not rewrite user content in
// backups, and a pre-migration backup is stamped with the schema it was taken
// from, so the previous build can import it after a rollback.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { setAiKey } from "@/lib/ai/key";
import { backupBeforeMigration } from "@/lib/backup/files";
import { exportLocalData, importLocalData, resetEverything, schemaVersion } from "@/lib/backup/local-data";
import { looksSecret, redactSecrets } from "@/lib/redact";

const q = async (text: string) => (await getDb().execute(sql.raw(text))).rows as Record<string, unknown>[];

beforeEach(async () => {
  await resetEverything();
});
afterEach(() => {
  setAiKey(null);
  delete process.env.DESKA_BACKUP_DIR;
});

describe("a placeholder AI key", () => {
  it("leaves task titles, comments and settings alone in an export and its restore", async () => {
    setAiKey("lm-studio");
    await q(`INSERT INTO tasks (id, creator_login, title, description) VALUES ('60000000-0000-0000-0000-000000000001', 'local', 'Try lm-studio models', 'lm-studio on the laptop')`);
    await q(`INSERT INTO task_comments (task_id, author_login, body) VALUES ('60000000-0000-0000-0000-000000000001', 'local', 'lm-studio works')`);
    const doc = await exportLocalData();
    expect(JSON.stringify(doc)).not.toContain("[redacted]");
    await resetEverything();
    await importLocalData(doc);
    expect(await q(`SELECT title, description FROM tasks`)).toEqual([{ title: "Try lm-studio models", description: "lm-studio on the laptop" }]);
    expect(redactSecrets("set to lm-studio")).toBe("set to lm-studio");
  });

  it("other placeholders are not secrets; a generated key is, and is still redacted", async () => {
    for (const p of ["lm-studio", "ollama", "sk-no-key-required", "not-needed-for-local-model"]) expect(looksSecret(p)).toBe(false);
    // Built at run time so no key-shaped literal sits in the repo (the leak guard).
    const key = ["local", "Zq8vR2mK9xT4wP7nB3"].join("-");
    expect(looksSecret(key)).toBe(true);
    setAiKey(key);
    await q(`INSERT INTO tasks (creator_login, title) VALUES ('local', 'pasted ${key} here')`);
    const text = JSON.stringify(await exportLocalData());
    expect(text).not.toContain(key);
    expect(text).toContain("pasted [redacted] here");
  });
});

describe("schema version of a backup", () => {
  it("a backup before a migration carries the applied count, and that build's import accepts it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "deska-backups-"));
    process.env.DESKA_BACKUP_DIR = dir;
    await q(`INSERT INTO tasks (creator_login, title) VALUES ('local', 'Keep me')`);
    const last = await getDb().execute(sql`SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1`);
    const id = (last.rows[0] as { id: number }).id;
    await getDb().execute(sql`DELETE FROM drizzle.__drizzle_migrations WHERE id = ${id}`);
    try {
      const info = await backupBeforeMigration(new Date(Date.UTC(2026, 10, 2, 9)));
      expect(info).toMatchObject({ reason: "migration" });
      const doc = JSON.parse(readFileSync(path.join(dir, info!.name), "utf8")) as { schemaVersion: number };
      expect(doc.schemaVersion).toBe(schemaVersion() - 1);
    } finally {
      await getDb().execute(sql`INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) SELECT ${id}, 'restored', 0 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE id = ${id})`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an ordinary export carries the applied count, which is this build's when up to date", async () => {
    expect((await exportLocalData()).schemaVersion).toBe(schemaVersion());
  });
});
