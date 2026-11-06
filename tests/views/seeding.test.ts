import { beforeEach, describe, expect, it, vi } from "vitest";
import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { fixtureSnapshot } from "../fixtures/github";

const getStore = vi.hoisted(() => vi.fn());
vi.mock("@/lib/store", () => ({ getStore }));

const { __resetViews, deleteView, viewsFor } = await import("@/lib/views/runtime");
const { SYSTEM_OWNER } = await import("@/lib/views/ids");

async function synced() {
  const store = new MemoryStore();
  await importFull(fixtureSnapshot(), store);
  return store;
}

describe("seed views", () => {
  beforeEach(() => {
    __resetViews();
    getStore.mockReset();
  });

  it("serves fallbacks before the first sync and seeds fully once it lands", async () => {
    // Regression: trySeedViews never returns [], so a visit before the first
    // sync persisted the seeds without the Core board for good.
    getStore.mockResolvedValue(new MemoryStore());
    const early = (await viewsFor("alice")).map((v) => v.id);
    expect(early).not.toContain("seed-core-board");
    expect(early).toContain("seed-untriaged");

    getStore.mockResolvedValue(await synced());
    expect((await viewsFor("alice")).map((v) => v.id)).toContain("seed-core-board");
  });

  it("keeps a deleted seed view deleted after a restart", async () => {
    // Regression: "seeded" was only a module flag, so every cold start
    // re-created any seed view its owner had deleted.
    getStore.mockResolvedValue(await synced());
    await viewsFor("alice");
    expect(await deleteView("alice", "seed-epics")).toBe(true);

    __resetViews({ restart: true });
    expect((await viewsFor("bob")).map((v) => v.id)).not.toContain("seed-epics");
    // The surviving seeds belong to no one, whoever visited first (v5 2.10).
    expect((await viewsFor("bob")).find((v) => v.id === "seed-untriaged")?.ownerId).toBe(SYSTEM_OWNER);
  });
});

describe("the in-memory views store (v5 2.10)", () => {
  it("is shared by every copy of the module, as in `next dev` where each route gets its own", async () => {
    getStore.mockResolvedValue(await synced());
    __resetViews();
    await viewsFor("alice");
    // A second copy of the module (another route in dev) must see the same views.
    vi.resetModules();
    const other = await import("@/lib/views/runtime");
    expect((await other.viewsFor("bob")).map((v) => v.id)).toContain("seed-epics");
    expect(await other.deleteView("bob", "seed-epics")).toBe(true);
    expect((await viewsFor("alice")).map((v) => v.id)).not.toContain("seed-epics");
    expect(await other.restoreView("alice", "seed-epics")).toMatchObject({ id: "seed-epics" }); // undo works across routes
  });
});
