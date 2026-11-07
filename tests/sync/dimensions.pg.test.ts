// D4 on the database (SPEC §4.1): single-select values by field ID in
// project_item_dims, a deleted field marked missing (never deleted), the
// mapping stored in app_settings, a remap that needs no new scan, and the
// migration that carries the old team/platform columns over.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { altFixtureSnapshot, ALT } from "@/lib/demo/fixtures-alt";
import { remap } from "@/lib/server/project-setup";
import { readMapping, resetSettingsCache, saveMapping } from "@/lib/settings";
import { invalidateReadCache, getStore } from "@/lib/store";
import { suggestMapping } from "@/lib/sync/field-map";
import { importFull } from "@/lib/sync/import";
import { PostgresStore, readSnapshot } from "@/lib/sync/store-postgres";

async function reset() {
  await getDb().execute(
    sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_item_dims, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, app_settings, issue_field_changes RESTART IDENTITY CASCADE`,
  );
  resetSettingsCache();
  invalidateReadCache();
}

describe("dimensions by field ID (Postgres)", () => {
  beforeEach(reset);

  it("stores every single-select and iteration value by field ID and reads it back", async () => {
    await importFull(altFixtureSnapshot(), new PostgresStore());
    const epic = (await readSnapshot()).projectItems.find((p) => p.issueNodeId === "I_epic")!;
    expect(epic.dims).toEqual({ [ALT.cycle]: "e0000023", [ALT.stage]: "f0000002", [ALT.squad]: "h0000001", [ALT.surface]: "k0000001", [ALT.urgency]: "g0000001" });
    const bug = (await readSnapshot()).projectItems.find((p) => p.issueNodeId === "I_bug")!;
    expect(bug.dims).toEqual({ [ALT.squad]: "h0000001", [ALT.surface]: "k0000002", [ALT.urgency]: "g0000002" });
  });

  it("a changed dimension value is an update and is recorded as `dim:<fieldId>`; a re-import writes nothing", async () => {
    const store = new PostgresStore();
    const snapshot = altFixtureSnapshot();
    await importFull(snapshot, store);
    const moved = { ...snapshot, projectItems: snapshot.projectItems.map((p) => (p.issueNodeId === "I_sub" ? { ...p, dims: { ...p.dims, [ALT.squad]: "h0000001", [ALT.surface]: "k0000001" } } : p)) };
    const stats = await importFull(moved, store);
    expect(stats.updated).toBeGreaterThan(0);
    const changes = await getDb().execute(sql`SELECT field, old_value, new_value FROM issue_field_changes ORDER BY field`);
    expect(changes.rows).toEqual([
      { field: `dim:${ALT.squad}`, old_value: "h0000002", new_value: "h0000001" },
      { field: `dim:${ALT.surface}`, old_value: null, new_value: "k0000001" },
    ]);
    expect(await importFull(moved, store)).toMatchObject({ inserted: 0, updated: 0 });
  });

  it("a field missing from a full field list is marked missing, not deleted, and comes back", async () => {
    const store = new PostgresStore();
    const snapshot = altFixtureSnapshot();
    await importFull(snapshot, store);
    await importFull({ ...snapshot, fields: snapshot.fields.filter((f) => f.id !== ALT.surface) }, store);
    expect((await readSnapshot()).fields.map((f) => f.id)).not.toContain(ALT.surface);
    const row = await getDb().execute(sql`SELECT missing_at FROM project_fields WHERE id = ${ALT.surface}`);
    expect((row.rows[0] as { missing_at: unknown }).missing_at).not.toBeNull();
    // The values stay: once the field is back, so are they.
    await importFull(snapshot, store);
    expect((await readSnapshot()).fields.map((f) => f.id)).toContain(ALT.surface);
    expect((await readSnapshot()).projectItems.find((p) => p.issueNodeId === "I_epic")?.dims?.[ALT.surface]).toBe("k0000001");
  });
});

describe("the mapping in app_settings", () => {
  beforeEach(reset);

  it("survives a restart (a fresh settings cache reads the table)", async () => {
    const m = suggestMapping(altFixtureSnapshot().fields, {});
    await saveMapping({ ...m, priorityOrder: "lowest-first", doneStatusIds: ["f0000003"] });
    resetSettingsCache();
    expect(await readMapping()).toEqual({ ...m, priorityOrder: "lowest-first", doneStatusIds: ["f0000003"] });
  });

  it("remapping Status re-reads the column from the values by field ID, without a scan or a recorded change", async () => {
    await importFull(altFixtureSnapshot(), new PostgresStore());
    const m = suggestMapping(altFixtureSnapshot().fields, {});
    await saveMapping(m);
    // Squad as Status, Stage as a dimension: an odd choice, but the user's.
    await remap({ ...m, status: { id: ALT.squad, name: "Squad" }, dimensions: [{ id: ALT.stage, name: "Stage" }, { id: ALT.surface, name: "Surface" }] });
    const items = (await readSnapshot()).projectItems;
    expect(items.find((p) => p.issueNodeId === "I_sub")?.statusOpt).toBe("h0000002");
    // And back: from the stored values again.
    await remap(m);
    expect((await readSnapshot()).projectItems.find((p) => p.issueNodeId === "I_sub")?.statusOpt).toBe("f0000001");
    const store = await getStore();
    expect(store.projectFieldMap().status?.id).toBe(ALT.stage);
    const changes = await getDb().execute(sql`SELECT count(*)::int AS n FROM issue_field_changes`);
    expect((changes.rows[0] as { n: number }).n).toBe(0);
  });

  it("refuses a mapping with an unknown field or the wrong type", async () => {
    await importFull(altFixtureSnapshot(), new PostgresStore());
    const m = suggestMapping(altFixtureSnapshot().fields, {});
    await expect(remap({ ...m, status: { id: "F_nope", name: "Nope" } })).rejects.toThrow(/not in the project/);
    await expect(remap({ ...m, sprint: { id: ALT.squad, name: "Squad" } })).rejects.toThrow(/iteration|already mapped/);
    expect(await readMapping()).toBeNull();
  });
});

describe("migration 0002", () => {
  it("moves team/platform values into project_item_dims by field ID and points saved views at dimension keys", async () => {
    const dir = path.join(process.cwd(), "drizzle");
    const journal = JSON.parse(readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
    const run = async (pg: PGlite, tag: string) => {
      for (const stmt of readFileSync(path.join(dir, `${tag}.sql`), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await pg.exec(stmt);
    };
    const pg = new PGlite("memory://", { extensions: { pg_trgm } });
    try {
      const [before, d4] = [journal.entries.filter((e) => e.tag < "0002"), journal.entries.find((e) => e.tag.startsWith("0002"))!];
      for (const e of before) await run(pg, e.tag);
      const map = { status: { id: "F_status", name: "Status" }, priority: null, team: { id: "F_team", name: "Team" }, platform: { id: "F_platform", name: "Platform" }, release: { id: "F_release", name: "Release" } };
      await pg.query(`INSERT INTO sync_state (key, value) VALUES ('fields.map', $1)`, [JSON.stringify(map)]);
      const issue = (await pg.query<{ id: string }>(`INSERT INTO issues (gh_node_id, number, title) VALUES ('I_1', 1, 'One') RETURNING id`)).rows[0]!.id;
      await pg.query(`INSERT INTO project_items (gh_item_id, issue_id, status_opt, team_opt, platform_opt, release_iter) VALUES ('PVTI_1', $1, 's1', 't1', NULL, 'r1')`, [issue]);
      const view = { id: "v1", name: "Team board", ownerId: "alice", visibility: "personal", layout: "board", filters: [{ field: "team", op: "in", values: ["t1"] }], sort: [{ field: "team", dir: "asc" }], groupBy: "platform", boardColumnsField: "team" };
      await pg.query(`INSERT INTO views (id, owner_id, name, definition_json) VALUES ('v1', 'alice', 'Team board', $1)`, [JSON.stringify(view)]);

      await run(pg, d4.tag);

      const dims = (await pg.query(`SELECT field_id, option_id FROM project_item_dims ORDER BY field_id`)).rows;
      expect(dims).toEqual([
        { field_id: "F_release", option_id: "r1" },
        { field_id: "F_status", option_id: "s1" },
        { field_id: "F_team", option_id: "t1" },
      ]);
      const def = (await pg.query<{ definition_json: Record<string, unknown> }>(`SELECT definition_json FROM views WHERE id = 'v1'`)).rows[0]!.definition_json;
      expect(def).toMatchObject({ name: "Team board", filters: [{ field: "dim:F_team", op: "in", values: ["t1"] }], sort: [{ field: "dim:F_team" }], groupBy: "dim:F_platform", boardColumnsField: "dim:F_team" });
      expect((await pg.query(`SELECT key FROM sync_state WHERE key = 'fields.map'`)).rows).toEqual([]);
      const cols = (await pg.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'project_items'`)).rows.map((r) => r.column_name);
      expect(cols).not.toContain("team_opt");
      expect(cols).not.toContain("platform_opt");
    } finally {
      await pg.close();
    }
  });
});
