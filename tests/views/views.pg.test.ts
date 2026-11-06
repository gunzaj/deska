// The views repo on Postgres (v5 2.10 and 2.6): save, delete, restore, the
// seeding flag, system-owned seeds and server-made IDs.
// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

describe("saved views (Postgres)", async () => {
  const { getDb } = await import("@/db");
  const { importFull } = await import("@/lib/sync/import");
  const { PostgresStore } = await import("@/lib/sync/store-postgres");
  const { invalidateReadCache } = await import("@/lib/store");
  const { __resetViews, deleteView, restoreView, saveView, submitView, viewsFor } = await import("@/lib/views/runtime");
  const { SYSTEM_OWNER } = await import("@/lib/views/ids");
  const { fixtureSnapshot } = await import("../fixtures/github");
  type View = import("@/lib/views/view").View;

  const mine = (over: Partial<View> = {}): View => ({ id: "v-mine", name: "Mine", ownerId: "alice", visibility: "shared", layout: "list", filters: [], sort: [], ...over });

  beforeEach(async () => {
    await getDb().execute(sql`TRUNCATE views, sync_state, issues, project_fields, field_options, iterations RESTART IDENTITY CASCADE`);
    await importFull(fixtureSnapshot(), new PostgresStore());
    invalidateReadCache();
    __resetViews();
  });

  it("seeds once, as a system-owned shared set, and remembers it across restarts", async () => {
    const first = await viewsFor("alice");
    const seeds = first.filter((v) => v.id.startsWith("seed-"));
    expect(seeds.length).toBeGreaterThan(3);
    expect(new Set(seeds.map((v) => v.ownerId))).toEqual(new Set([SYSTEM_OWNER]));
    expect(seeds.every((v) => v.visibility === "shared")).toBe(true);

    // The owner of a seed is nobody in particular: a different first visitor
    // would have produced the same set.
    expect((await getDb().execute(sql`SELECT value FROM sync_state WHERE key = 'views.seeded'`)).rows).toHaveLength(1);
    __resetViews({ restart: true }); // a cold start keeps the rows and the flag
    expect((await viewsFor("bob")).filter((v) => v.id.startsWith("seed-")).map((v) => v.id).sort()).toEqual(seeds.map((v) => v.id).sort());
  });

  it("anyone can edit, delete and restore a seed view", async () => {
    const seed = (await viewsFor("alice")).find((v) => v.id === "seed-untriaged")!;
    const edited = await saveView("bob", { ...seed, name: "Untriaged (renamed)" });
    expect(edited).toMatchObject({ name: "Untriaged (renamed)", ownerId: SYSTEM_OWNER });
    expect(await deleteView("bob", seed.id)).toBe(true);
    expect((await viewsFor("alice")).some((v) => v.id === seed.id)).toBe(false);
    expect(await restoreView("alice", seed.id)).toMatchObject({ id: seed.id });
    expect((await viewsFor("alice")).some((v) => v.id === seed.id)).toBe(true);
  });

  it("a person's own view stays theirs: others cannot edit, delete or restore it", async () => {
    await saveView("alice", mine());
    expect(await saveView("bob", mine({ name: "Hijacked", ownerId: "bob" }))).toBeNull();
    expect(await deleteView("bob", "v-mine")).toBe(false);
    expect(await deleteView("alice", "v-mine")).toBe(true);
    expect(await restoreView("bob", "v-mine")).toBeNull();
    expect(await restoreView("alice", "v-mine")).toMatchObject({ id: "v-mine" });
    expect((await viewsFor("bob")).find((v) => v.id === "v-mine")?.name).toBe("Mine");
  });

  it("a personal view is hidden from other people", async () => {
    await saveView("alice", mine({ visibility: "personal" }));
    expect((await viewsFor("bob")).some((v) => v.id === "v-mine")).toBe(false);
    expect((await viewsFor("Alice")).some((v) => v.id === "v-mine")).toBe(true);
  });

  it("a new view gets a server-made ID; an existing ID is only honoured for an update", async () => {
    await viewsFor("alice"); // seed
    const created = await submitView("bob", mine({ id: "seed-untriaged-copy", ownerId: "bob" }));
    expect(created?.id).not.toBe("seed-untriaged-copy"); // the client chose no ID
    expect(created?.id).toMatch(/^v-/);
    const updated = await submitView("bob", { ...created!, name: "Renamed" });
    expect(updated).toMatchObject({ id: created!.id, name: "Renamed" });
    // Another person cannot take over that ID by posting it.
    expect(await submitView("alice", { ...created!, name: "Mine now", ownerId: "alice" })).toBeNull();
  });
});
