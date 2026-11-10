// SPEC §4.1: when a sync holds the lock for longer than the wait, the fields
// are not cached, so choosing a project or reloading fields must not report
// success: they answer 409 "A sync is running, try again".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("@/lib/github/projects", async (orig) => {
  const real = await orig<typeof import("@/lib/github/projects")>();
  return {
    ...real,
    checkRepo: async () => undefined,
    fetchProjectDetail: async () => ({
      id: "PVT_acme_widgets_roadmap",
      number: 7,
      title: "Widgets Roadmap",
      fields: [{ id: "PVTSSF_acme_status", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "o_todo", name: "Todo", color: "GRAY" }] }],
    }),
  };
});
vi.mock("@/lib/sync/service", () => ({ syncService: () => ({ request: () => undefined, interrupt: async () => undefined }) }));
// A sync that holds the lock past the wait.
vi.mock("@/lib/sync/runtime", async (orig) => ({
  ...(await orig<typeof import("@/lib/sync/runtime")>()),
  withLockedSyncKv: async () => ({ ran: false }),
}));

describe("caching fields while a sync holds the lock", async () => {
  const { getDb } = await import("@/db");
  const { resetSettingsCache, readTarget } = await import("@/lib/settings");
  const { setLocalToken } = await import("@/lib/github/local-token");
  const { invalidateReadCache } = await import("@/lib/store");
  const { chooseProject, reloadFields } = await import("@/lib/server/project-setup");
  const { HttpError } = await import("@/lib/server/route");
  const { suggestMapping } = await import("@/lib/sync/field-map");

  const TOKEN = ["github", "pat", "LOCKED", "FAKE", "0".repeat(24)].join("_");
  const q = async (text: string) => (await getDb().execute(sql.raw(text))).rows as Record<string, unknown>[];
  const mapping = suggestMapping([{ id: "PVTSSF_acme_status", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "o_todo", name: "Todo" }] }]);

  beforeEach(async () => {
    await q(`TRUNCATE issues, project_fields, field_options, sync_state, app_settings RESTART IDENTITY CASCADE`);
    resetSettingsCache();
    invalidateReadCache();
    setLocalToken(TOKEN, "launch");
  });

  it("chooseProject answers 409 and stores no target", async () => {
    const err = await chooseProject({ repo: "acme/widgets", org: "acme", projectNumber: 7, mapping }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, message: "A sync is running, try again" });
    expect(await readTarget()).toBeNull();
    expect(await q(`SELECT id FROM project_fields`)).toEqual([]);
  });

  it("reloadFields answers 409", async () => {
    const { saveTarget } = await import("@/lib/settings");
    await saveTarget({ repo: "acme/widgets", org: "acme", projectNumber: 7, projectId: "PVT_acme_widgets_roadmap", projectTitle: "Widgets Roadmap" });
    await expect(reloadFields()).rejects.toMatchObject({ status: 409 });
  });
});
