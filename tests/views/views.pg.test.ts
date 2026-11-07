// The views repo on Postgres (v5 2.10 and 2.6): save, delete, restore, the
// seeding flag and server-made IDs. Views are local: no owner, no visibility (D7).
// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

describe("saved views (Postgres)", async () => {
  const { getDb } = await import("@/db");
  const { importFull } = await import("@/lib/sync/import");
  const { PostgresStore } = await import("@/lib/sync/store-postgres");
  const { invalidateReadCache } = await import("@/lib/store");
  const { __resetViews, deleteView, restoreView, saveView, submitView, viewsFor } = await import("@/lib/views/runtime");
  const { fixtureSnapshot } = await import("../fixtures/github");
  type View = import("@/lib/views/view").View;

  const mine = (over: Partial<View> = {}): View => ({ id: "v-mine", name: "Mine", layout: "list", filters: [], sort: [], ...over });

  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE views, sync_state, issues, project_fields, field_options, iterations RESTART IDENTITY CASCADE`);
    await importFull(fixtureSnapshot(), new PostgresStore());
    invalidateReadCache();
    __resetViews();
  });

  it("seeds once and remembers it across restarts", async () => {
    const first = await viewsFor();
    const seeds = first.filter((v) => v.id.startsWith("seed-"));
    expect(seeds.length).toBeGreaterThan(3);

    expect((await getDb().execute(sql`SELECT value FROM sync_state WHERE key = 'views.seeded'`)).rows).toHaveLength(1);
    __resetViews({ restart: true }); // a cold start keeps the rows and the flag
    expect((await viewsFor()).filter((v) => v.id.startsWith("seed-")).map((v) => v.id).sort()).toEqual(seeds.map((v) => v.id).sort());
  });

  it("a seed view can be edited, deleted and restored like any other", async () => {
    const seed = (await viewsFor()).find((v) => v.id === "seed-untriaged")!;
    const edited = await saveView({ ...seed, name: "Untriaged (renamed)" });
    expect(edited).toMatchObject({ name: "Untriaged (renamed)" });
    expect(await deleteView(seed.id)).toBe(true);
    expect((await viewsFor()).some((v) => v.id === seed.id)).toBe(false);
    expect(await restoreView(seed.id)).toMatchObject({ id: seed.id });
    expect((await viewsFor()).some((v) => v.id === seed.id)).toBe(true);
  });

  it("a saved view survives delete and restore, and stores no owner or visibility", async () => {
    await saveView(mine());
    expect(await deleteView("v-mine")).toBe(true);
    expect(await restoreView("v-mine")).toMatchObject({ id: "v-mine" });
    expect((await viewsFor()).find((v) => v.id === "v-mine")?.name).toBe("Mine");
    const stored = (await getDb().execute(sql`SELECT definition_json FROM views WHERE id = 'v-mine'`)).rows[0]!.definition_json as Record<string, unknown>;
    expect(Object.keys(stored)).not.toContain("ownerId");
    expect(Object.keys(stored)).not.toContain("visibility");
  });

  it("a new view gets a server-made ID; an existing ID is only honoured for an update", async () => {
    await viewsFor(); // seed
    const created = await submitView(mine({ id: "seed-untriaged-copy" }));
    expect(created?.id).not.toBe("seed-untriaged-copy"); // the client chose no ID
    expect(created?.id).toMatch(/^v-/);
    const updated = await submitView({ ...created!, name: "Renamed" });
    expect(updated).toMatchObject({ id: created!.id, name: "Renamed" });
  });
});
