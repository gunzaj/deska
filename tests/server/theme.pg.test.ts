// ADR-001: the colour theme lives in app_settings, so it survives a relaunch
// (the window's origin, and with it localStorage, changes every launch).
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

describe("stored theme (ADR-001)", async () => {
  const { getDb } = await import("@/db");
  const { readTheme, resetSettingsCache, saveTheme, settingsVersion } = await import("@/lib/settings");
  const { GET, POST } = await import("@/app/api/settings/theme/route");

  beforeEach(async () => {
    await getDb().execute(sql`DELETE FROM app_settings WHERE key = 'ui.theme'`);
    resetSettingsCache();
  });

  it("defaults to system, and a saved theme is read back after the cache is gone (a relaunch)", async () => {
    expect(await readTheme()).toBe("system");
    await saveTheme("dark");
    resetSettingsCache();
    expect(await readTheme()).toBe("dark");
  });

  it("a theme change does not bump the settings version (no data refetch)", async () => {
    await readTheme();
    const before = settingsVersion();
    await saveTheme("light");
    expect(settingsVersion()).toBe(before);
  });

  it("an unknown stored value reads as system", async () => {
    await getDb().execute(sql`INSERT INTO app_settings (key, value, updated_at) VALUES ('ui.theme', '"neon"'::jsonb, now())`);
    expect(await readTheme()).toBe("system");
  });

  it("the route saves only the three themes", async () => {
    const post = (theme: unknown) =>
      POST(new Request("http://127.0.0.1:3000/api/settings/theme", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ theme }) }) as never);
    expect((await post("neon")).status).toBe(400);
    expect((await post("dark")).status).toBe(200);
    expect(await (await GET(new Request("http://127.0.0.1:3000/api/settings/theme") as never)).json()).toEqual({ theme: "dark" });
  });
});
