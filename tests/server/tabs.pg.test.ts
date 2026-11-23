// In-app tabs are restored after a relaunch: they live in app_settings
// (ADR-001), like the theme, because localStorage is emptied every launch.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));

describe("stored tabs (ADR-001)", async () => {
  const { getDb } = await import("@/db");
  const { readTabs, resetSettingsCache, settingsVersion } = await import("@/lib/settings");
  const { POST } = await import("@/app/api/settings/tabs/route");

  beforeEach(async () => {
    await getDb().execute(sql`DELETE FROM app_settings WHERE key = 'ui.tabs'`);
    resetSettingsCache();
  });

  const post = (body: unknown) =>
    POST(new Request("http://127.0.0.1:3000/api/settings/tabs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never);

  it("saves only in-app URLs, survives a relaunch, and does not bump the settings version", async () => {
    expect(await readTabs()).toBeNull();
    const before = settingsVersion();
    const res = await post({ tabs: [{ entries: ["/my", "https://evil.example/"], index: 1 }, { entries: ["/issues/101"], index: 0 }], active: 1 });
    expect(res.status).toBe(200);
    expect(settingsVersion()).toBe(before);
    resetSettingsCache();
    expect(await readTabs()).toEqual({ tabs: [{ entries: ["/my"], index: 0 }, { entries: ["/issues/101"], index: 0 }], active: 1 });
  });

  it("refuses a malformed body", async () => {
    expect((await post({ tabs: "nope", active: 0 })).status).toBe(400);
    expect((await post({ tabs: [], active: 0, extra: 1 })).status).toBe(400);
  });
});
