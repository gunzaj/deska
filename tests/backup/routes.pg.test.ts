// The /api/local-data routes (D8): the two-step reset, error statuses, headers.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { GET as status } from "@/app/api/local-data/status/route";
import { GET as exportRoute } from "@/app/api/local-data/export/route";
import { POST as importRoute } from "@/app/api/local-data/import/route";
import { POST as resetAll } from "@/app/api/local-data/reset-all/route";
import { POST as resetCache } from "@/app/api/local-data/reset-cache/route";
import { POST as backupNow } from "@/app/api/local-data/backup/route";
import { POST as recover } from "@/app/api/local-data/recover/route";
import { MAX_IMPORT_BYTES } from "@/lib/backup/local-data";

const post = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://127.0.0.1:3000${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const tasks = async () => Number(((await getDb().execute(sql`SELECT count(*)::int AS n FROM tasks`)).rows[0] as { n: number }).n);
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "deska-routes-"));
  process.env.DESKA_BACKUP_DIR = dir;
  await getDb().execute(sql`TRUNCATE tasks CASCADE`);
  await getDb().execute(sql`INSERT INTO tasks (creator_login, title) VALUES ('local', 'Mine')`);
});
afterEach(() => {
  delete process.env.DESKA_BACKUP_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("/api/local-data", () => {
  it("status: database ok, backups listed (names and dates only)", async () => {
    await backupNow(post("/api/local-data/backup"));
    const body = await (await status(new Request("http://127.0.0.1:3000/api/local-data/status"))).json();
    expect(body.database).toEqual({ ok: true, error: null });
    expect(body.backups.enabled).toBe(true);
    expect(body.backups.items).toHaveLength(1);
    expect(Object.keys(body.backups.items[0]).sort()).toEqual(["bytes", "createdAt", "name", "reason"]);
    expect(body.backups.health).toMatchObject({ error: null, mirrorDir: null, mirrorError: null, missing: 0 });
  });

  it("export is a JSON attachment", async () => {
    const res = await exportRoute(new Request("http://127.0.0.1:3000/api/local-data/export"));
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="deska-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect((await res.json()).tables.tasks).toHaveLength(1);
  });

  it("reset everything needs the confirmation in the request, and backs up first", async () => {
    expect((await resetAll(post("/api/local-data/reset-all"))).status).toBe(400);
    expect((await resetAll(post("/api/local-data/reset-all", { confirm: "yes" }))).status).toBe(400);
    expect(await tasks()).toBe(1);

    const res = await resetAll(post("/api/local-data/reset-all", { confirm: "reset-everything" }));
    expect(res.status).toBe(200);
    expect(await tasks()).toBe(0);
    // The backup taken before the reset still has the task.
    const name = (await res.json()).backup as string;
    expect(readdirSync(dir)).toContain(name);
  });

  it("reset GitHub cache keeps tasks", async () => {
    expect((await resetCache(post("/api/local-data/reset-cache"))).status).toBe(200);
    expect(await tasks()).toBe(1);
  });

  it("import answers 400 for a file that is not a backup, and refuses a cross-origin call", async () => {
    expect((await importRoute(post("/api/local-data/import", { nope: true }))).status).toBe(400);
    expect((await importRoute(post("/api/local-data/import", { nope: true }, { origin: "http://evil.example" }))).status).toBe(403);
    expect((await resetAll(post("/api/local-data/reset-all", { confirm: "reset-everything" }, { origin: "http://evil.example" }))).status).toBe(403);
    expect(await tasks()).toBe(1);
  });

  it("recover refuses while the database is fine", async () => {
    expect((await recover(post("/api/local-data/recover", { mode: "restore" }))).status).toBe(409);
    expect((await recover(post("/api/local-data/recover", { mode: "other" }))).status).toBe(400);
  });
});

describe("B-3: large import files", () => {
  it("reads a valid export of 11 MB (past Next's 10 MB default) and imports it", async () => {
    const doc = await (await exportRoute(new Request("http://127.0.0.1:3000/api/local-data/export"))).json();
    doc.tables.tasks[0].description = "x".repeat(11 * 1024 * 1024);
    const body = JSON.stringify(doc);
    expect(body.length).toBeGreaterThan(10 * 1024 * 1024);
    await getDb().execute(sql`TRUNCATE tasks CASCADE`);
    const res = await importRoute(new Request("http://127.0.0.1:3000/api/local-data/import", { method: "POST", headers: { "content-type": "application/json" }, body }));
    expect(res.status).toBe(200);
    expect(await tasks()).toBe(1);
  });

  it("answers a file over the limit with a distinct error, and next.config raises Next's body limit to match", async () => {
    const res = await importRoute(post("/api/local-data/import", {}, { "content-length": String(MAX_IMPORT_BYTES + 1) }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/too large/);
    const { default: config } = await import("../../next.config");
    expect(config.experimental?.middlewareClientMaxBodySize).toBe(`${MAX_IMPORT_BYTES / 1024 / 1024}mb`);
  });
});
