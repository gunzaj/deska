// W2: the Done Status for closing and the close gate (SPEC §4.8).
// Runs on an in-memory PGlite database; the Status field is the fixture's.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));

const json = (url: string, body?: unknown) =>
  new NextRequest(`http://127.0.0.1:3000${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (url: string) => new NextRequest(`http://127.0.0.1:3000${url}`);

describe("the Done Status for closing (W2)", async () => {
  const { getDb } = await import("@/db");
  const { fixtureSnapshot } = await import("../fixtures/github");
  const { importFull } = await import("@/lib/sync/import");
  const { PostgresStore } = await import("@/lib/sync/store-postgres");
  const { getStore, invalidateReadCache } = await import("@/lib/store");
  const { resetSettingsCache, saveCloseDoneStatus, saveMapping, saveWriteAccess, saveWrites } = await import("@/lib/settings");
  const { setLocalToken } = await import("@/lib/github/local-token");
  const { GET, POST } = await import("@/app/api/settings/close/route");
  const { loadClientData } = await import("@/lib/server/data");

  beforeEach(async () => {
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, app_settings, outbox, audit_log RESTART IDENTITY CASCADE`,
    );
    await importFull(fixtureSnapshot(), new PostgresStore());
    invalidateReadCache();
    const store = await getStore();
    await saveMapping(store.projectFieldMap());
    invalidateReadCache();
    resetSettingsCache();
    setLocalToken(null, "launch");
    delete process.env.DESKA_WRITES;
  });

  it("lists the mapped Status options by ID and refuses an option that is not one", async () => {
    const listed = (await (await GET(get("/api/settings/close"))).json()) as { options: { id: string }[]; doneId: string | null };
    expect(listed.doneId).toBeNull();
    expect(listed.options.map((o) => o.id)).toEqual(["a0000001", "a0000002", "a0000006"]);
    expect((await POST(json("/api/settings/close", { optionId: "not-an-option" }))).status).toBe(400);
    expect((await POST(json("/api/settings/close", { optionId: "a0000006" }))).status).toBe(200);
    const after = (await (await GET(get("/api/settings/close"))).json()) as { doneId: string | null };
    expect(after.doneId).toBe("a0000006");
    // Clearing it is allowed: Close is then refused again.
    expect((await POST(json("/api/settings/close", { optionId: null }))).status).toBe(200);
    expect(((await (await GET(get("/api/settings/close"))).json()) as { doneId: string | null }).doneId).toBeNull();
  });

  it("with writes on, closeBlocked names the missing choice and clears when it is chosen", async () => {
    process.env.DESKA_WRITES = "on";
    await saveWrites(true);
    await saveWriteAccess({ state: "yes", message: null, checkedAt: null });
    setLocalToken(["github", "pat", "CLOSE", "FAKE", "0".repeat(24)].join("_"), "launch");
    const before = await loadClientData();
    expect(before.data().meta.writeMode).toBe(true);
    expect(before.data().meta.closeBlocked).toContain("Choose a Done Status");
    await saveCloseDoneStatus("a0000006");
    const after = await loadClientData();
    expect(after.data().meta.closeBlocked).toBeNull();
    delete process.env.DESKA_WRITES;
  });
});
