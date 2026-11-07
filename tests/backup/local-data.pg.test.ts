// SPEC §4.7 / D8 against the embedded database: export, import, both resets.
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { exportLocalData, importLocalData, LocalDataError, LOCAL_TABLES, resetEverything, resetGithubCache } from "@/lib/backup/local-data";
import { setLocalToken } from "@/lib/github/local-token";
import { readMapping, readTarget, resetSettingsCache, saveMapping, saveTarget } from "@/lib/settings";
import { effectiveMapping } from "@/lib/sync/field-map";

const q = async (text: string) => (await getDb().execute(sql.raw(text))).rows as Record<string, unknown>[];
const count = async (table: string) => Number((await q(`SELECT count(*)::int AS n FROM ${table}`))[0]!.n);

const T1 = "60000000-0000-0000-0000-000000000001";
const T2 = "60000000-0000-0000-0000-000000000002";
const P1 = "60000000-0000-0000-0000-0000000000a1";
const L1 = "60000000-0000-0000-0000-0000000000b1";
// Built at run time so no token-shaped literal sits in the repo (the leak guard).
const TOKEN = ["github", "pat", "11AAAAAAA0abcdefghijklmnopqrstuvwxyz0123456789"].join("_");

async function seedLocal() {
  await q(`INSERT INTO task_projects (id, owner_login, name, color) VALUES ('${P1}', 'local', 'Errands', 'blue')`);
  await q(`INSERT INTO task_labels (id, owner_login, name) VALUES ('${L1}', 'local', 'home')`);
  await q(`INSERT INTO tasks (id, creator_login, title, due_date, priority) VALUES ('${T1}', 'local', 'Buy milk', '2026-11-09', 2)`);
  await q(`INSERT INTO tasks (id, creator_login, title, parent_id) VALUES ('${T2}', 'local', 'Oat milk', '${T1}')`);
  await q(`INSERT INTO task_placements (task_id, login, project_id, position) VALUES ('${T1}', 'local', '${P1}', 1.5)`);
  await q(`INSERT INTO task_label_links (task_id, label_id) VALUES ('${T1}', '${L1}')`);
  await q(`INSERT INTO task_links (task_id, target_kind, target_node_id, target_number) VALUES ('${T1}', 'issue', 'I_acme_1', 101)`);
  await q(`INSERT INTO task_comments (task_id, author_login, body) VALUES ('${T1}', 'local', 'a note')`);
  await q(`INSERT INTO triage_snoozes (login, issue_node_id, until) VALUES ('local', 'I_acme_2', '2026-12-01')`);
  await q(`INSERT INTO watches (login, kind, target_id) VALUES ('local', 'issue', 'I_acme_3')`);
  await q(`INSERT INTO views (id, name, definition_json) VALUES ('v-mine', 'Mine', '{"id":"v-mine","name":"Mine","layout":"list","filters":[],"sort":[]}')`);
  await saveTarget({ repo: "acme/widgets", org: "acme", projectNumber: 7, projectId: "PVT_acme_widgets_roadmap", projectTitle: "Widgets Roadmap" });
  await saveMapping(effectiveMapping(null, []));
}

async function seedCache() {
  await q(`INSERT INTO issues (gh_node_id, number, title, state) VALUES ('I_acme_1', 101, 'Cached', 'open') ON CONFLICT DO NOTHING`);
  await q(`INSERT INTO sync_state (key, value) VALUES ('issues.since', '2026-11-01T00:00:00Z'), ('github.login', 'alice'), ('import.phase', 'items') ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
}

beforeEach(async () => {
  await resetEverything();
  setLocalToken(null, "launch");
});

describe("export", () => {
  it("holds every local table and nothing of the GitHub cache", async () => {
    await seedLocal();
    await seedCache();
    const doc = await exportLocalData(new Date("2026-11-08T10:00:00Z"));
    expect(doc).toMatchObject({ kind: "deska-backup", v: 1, createdAt: "2026-11-08T10:00:00.000Z" });
    expect(Object.keys(doc.tables).sort()).toEqual(LOCAL_TABLES.map((t) => t.name).sort());
    expect(doc.tables.tasks!.map((r) => r.title).sort()).toEqual(["Buy milk", "Oat milk"]);
    expect(doc.tables.task_projects).toHaveLength(1);
    expect(doc.tables.app_settings!.map((r) => r.key).sort()).toEqual(["github.target", "project.mapping"]);
    expect(JSON.stringify(doc)).not.toContain("Cached");
  });

  it("never contains the token, not even one pasted into a task", async () => {
    setLocalToken(TOKEN, "user");
    await q(`INSERT INTO tasks (id, creator_login, title, description) VALUES ('${T1}', 'local', 'Use ${TOKEN}', 'again ${TOKEN}')`);
    const text = JSON.stringify(await exportLocalData());
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("github_pat_");
    expect(text).toContain("[redacted]");
  });
});

describe("import", () => {
  it("export → Reset everything → import restores all local-only data", async () => {
    await seedLocal();
    const before = await exportLocalData();
    await resetEverything();
    expect(await count("tasks")).toBe(0);
    expect(await count("app_settings")).toBe(0);

    const res = await importLocalData(JSON.parse(JSON.stringify(before)));
    expect(res.added).toBeGreaterThan(10);
    resetSettingsCache();
    const after = await exportLocalData();
    expect(after.tables).toEqual(before.tables);
    expect((await readTarget())?.repo).toBe("acme/widgets");
    expect(await readMapping()).not.toBeNull();
  });

  it("merges by ID: existing rows stay as they are, new ones are added", async () => {
    await seedLocal();
    const doc = await exportLocalData();
    await q(`UPDATE tasks SET title = 'Changed here' WHERE id = '${T1}'`);
    await q(`DELETE FROM tasks WHERE id = '${T2}'`);
    const res = await importLocalData(doc);
    expect(res.tables.tasks).toEqual({ rows: 2, added: 1 });
    expect((await q(`SELECT title FROM tasks ORDER BY title`)).map((r) => r.title)).toEqual(["Changed here", "Oat milk"]);
    // A second import adds nothing.
    expect((await importLocalData(doc)).added).toBe(0);
  });

  it("does not touch the GitHub cache", async () => {
    await seedCache();
    const doc = await exportLocalData();
    await importLocalData(doc);
    expect(await count("issues")).toBe(1);
    expect((await q(`SELECT value FROM sync_state WHERE key = 'issues.since'`))[0]!.value).toBe("2026-11-01T00:00:00Z");
  });

  it("skips a row whose parent is missing instead of failing", async () => {
    await seedLocal();
    const doc = await exportLocalData();
    await resetEverything();
    doc.tables.tasks = doc.tables.tasks!.filter((r) => r.id !== T1);
    doc.tables.task_placements = [];
    await importLocalData(doc);
    // The sub-task's parent is gone from the file: it is dropped, with the rows that hang off the missing task.
    expect(await count("tasks")).toBe(0);
    expect(await count("task_links")).toBe(0);
  });

  it("rejects what is not a backup, an unknown table, and a newer schema; changes nothing", async () => {
    await seedLocal();
    const doc = await exportLocalData();
    await expect(importLocalData({ hello: 1 })).rejects.toThrow(LocalDataError);
    await expect(importLocalData({ ...doc, tables: { ...doc.tables, issues: [] } })).rejects.toThrow(/does not know/);
    await expect(importLocalData({ ...doc, schemaVersion: 999 })).rejects.toThrow(/newer version/);
    expect(await count("tasks")).toBe(2);
  });

  it("a document that fails part-way changes nothing", async () => {
    await seedLocal();
    const doc = await exportLocalData();
    await resetEverything();
    // A task priority outside 1-4 breaks the table's check constraint, after earlier tables went in.
    doc.tables.tasks = doc.tables.tasks!.map((r) => ({ ...r, priority: 9 }));
    await expect(importLocalData(doc)).rejects.toThrow(/Nothing was changed/);
    expect(await count("task_projects")).toBe(0);
    expect(await count("views")).toBe(0);
  });

  it("skips views the strict schema refuses", async () => {
    const doc = await exportLocalData();
    doc.tables.views = [{ id: "bad", name: "Bad", definition_json: { id: "bad", name: "Bad", layout: "nope" }, position: 0, updated_at: null, deleted_at: null }];
    await importLocalData(doc);
    expect(await count("views")).toBe(0);
  });
});

describe("resets", () => {
  it("Reset GitHub cache clears the cache and cursors; tasks, views, settings and identity stay", async () => {
    await seedLocal();
    await seedCache();
    await resetGithubCache();
    expect(await count("issues")).toBe(0);
    expect((await q(`SELECT key FROM sync_state WHERE key IN ('issues.since', 'import.phase')`))).toHaveLength(0);
    // First import is pending again, the PAT owner is still known.
    expect((await q(`SELECT value FROM sync_state WHERE key = 'github.login'`))[0]!.value).toBe("alice");
    expect(await count("tasks")).toBe(2);
    expect(await count("task_links")).toBe(1);
    expect(await count("triage_snoozes")).toBe(1);
    expect(await count("watches")).toBe(1);
    expect(await count("views")).toBe(1);
    expect(await count("app_settings")).toBe(2);
  });

  it("Reset everything empties every table, keeps the migrations", async () => {
    await seedLocal();
    await seedCache();
    await resetEverything();
    for (const t of ["tasks", "task_projects", "views", "app_settings", "issues", "sync_state", "watches"]) expect(await count(t), t).toBe(0);
    expect(Number((await q(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`))[0]!.n)).toBeGreaterThan(0);
  });
});
