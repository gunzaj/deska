// SPEC §4.2: the built-in lists keep their own filters and display options in
// `ui.lists` (ADR-001), so a relaunch, a backup and an export carry them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { ListState } from "@/lib/views/list-prefs";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));

const MY_STATE: ListState = {
  filters: [{ field: "author", op: "in", values: ["alice"] }],
  sort: [{ field: "priority", dir: "desc" }],
  groupBy: "status",
  layout: "table",
  columns: ["id", "status", "priority"],
};

describe("built-in list defaults (ADR-001)", async () => {
  const { getDb } = await import("@/db");
  const { clearListPrefs, readListPrefs, resetSettingsCache, saveListPref, settingsVersion } = await import("@/lib/settings");
  const { DELETE, GET, PATCH } = await import("@/app/api/me/list-prefs/route");

  beforeEach(async () => {
    await getDb().execute(sql`DELETE FROM app_settings WHERE key = 'ui.lists'`);
    resetSettingsCache();
  });

  const patch = (body: unknown) =>
    PATCH(new Request("http://127.0.0.1:3000/api/me/list-prefs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never);
  const del = (key?: string) =>
    DELETE(new Request(`http://127.0.0.1:3000/api/me/list-prefs${key ? `?key=${key}` : ""}`, { method: "DELETE" }) as never);
  const lists = async (res: Response) => ((await res.json()) as { lists: Record<string, unknown> }).lists;

  it("defaults to nothing, then reads a saved page back after the cache is gone (a relaunch)", async () => {
    expect(await readListPrefs()).toEqual({});
    expect(await lists(await GET(new Request("http://127.0.0.1:3000/api/me/list-prefs") as never))).toEqual({});
    const before = settingsVersion();
    expect((await patch({ key: "my", state: MY_STATE })).status).toBe(200);
    // No issue changed: the data ETag must not move.
    expect(settingsVersion()).toBe(before);
    resetSettingsCache();
    expect(await readListPrefs()).toEqual({ my: MY_STATE });
  });

  it("keeps one state per page and forgets one page at a time", async () => {
    await patch({ key: "my", state: MY_STATE });
    await patch({ key: "epics", state: { ...MY_STATE, layout: "board", boardColumnsField: "status" } });
    expect(Object.keys(await readListPrefs()).sort()).toEqual(["epics", "my"]);
    expect(await lists(await del("epics"))).toEqual({ my: MY_STATE });
    resetSettingsCache();
    expect(Object.keys(await readListPrefs())).toEqual(["my"]);
  });

  it("forgets every page without a key", async () => {
    await saveListPref("my", MY_STATE);
    await saveListPref("backlog", MY_STATE);
    expect(await lists(await del())).toEqual({});
    resetSettingsCache();
    expect(await readListPrefs()).toEqual({});
  });

  it("refuses a malformed key or state", async () => {
    expect((await patch({ key: "My issues", state: MY_STATE })).status).toBe(400);
    expect((await patch({ key: "my", state: { ...MY_STATE, layout: "calendar" } })).status).toBe(400);
    expect((await patch({ key: "my", state: MY_STATE, extra: 1 })).status).toBe(400);
    expect((await patch({ key: "my" })).status).toBe(400);
  });

  it("an invalid stored value reads as no defaults (an imported backup)", async () => {
    await getDb().execute(
      sql`INSERT INTO app_settings (key, value, updated_at) VALUES ('ui.lists', ${JSON.stringify({
        my: { layout: "calendar", filters: [], sort: [] },
        epics: MY_STATE,
      })}::jsonb, now())`,
    );
    resetSettingsCache();
    expect(await readListPrefs()).toEqual({ epics: MY_STATE });
    await getDb().execute(sql`DELETE FROM app_settings WHERE key = 'ui.lists'`);
    resetSettingsCache();
    expect(await clearListPrefs()).toEqual({});
  });
});
