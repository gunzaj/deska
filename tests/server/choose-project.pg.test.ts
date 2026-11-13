// "Change project…" to another repository or project (SPEC §4.1): the old
// cache and sync cursors must not carry over, or the next poll skips the first
// import and only fetches what changed after the old repo's cursor.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const projects = vi.hoisted(() => ({ current: { id: "PVT_acme_widgets_roadmap", number: 7, title: "Widgets Roadmap" } }));
vi.mock("@/lib/github/projects", async (orig) => {
  const real = await orig<typeof import("@/lib/github/projects")>();
  return {
    ...real,
    checkRepo: async () => undefined,
    fetchProjectDetail: async () => ({
      ...projects.current,
      fields: [{ id: "F_status", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "o_todo", name: "Todo", color: "GRAY" }] }],
    }),
  };
});
const sync = vi.hoisted(() => ({ requests: [] as string[], interrupts: 0 }));
vi.mock("@/lib/sync/service", () => ({
  syncService: () => ({ request: (why: string) => void sync.requests.push(why), interrupt: async () => void (sync.interrupts += 1) }),
}));

describe("choosing a project", async () => {
  const { getDb } = await import("@/db");
  const { resetSettingsCache, readTarget, saveMapping, saveTarget } = await import("@/lib/settings");
  const { setLocalToken } = await import("@/lib/github/local-token");
  const { invalidateReadCache } = await import("@/lib/store");
  const { chooseProject, remap } = await import("@/lib/server/project-setup");
  const { withSyncLock } = await import("@/lib/sync/lock");
  const { suggestMapping } = await import("@/lib/sync/field-map");

  const TOKEN = ["github", "pat", "CHOOSE", "FAKE", "0".repeat(24)].join("_");
  const q = async (text: string) => (await getDb().execute(sql.raw(text))).rows as Record<string, unknown>[];
  const mapping = suggestMapping([{ id: "F_status", name: "Status", dataType: "SINGLE_SELECT", options: [{ id: "o_todo", name: "Todo" }] }]);

  beforeEach(async () => {
    await q(`TRUNCATE issues, project_fields, field_options, sync_state, app_settings RESTART IDENTITY CASCADE`);
    resetSettingsCache();
    invalidateReadCache();
    sync.requests = [];
    sync.interrupts = 0;
    setLocalToken(TOKEN, "launch");
    projects.current = { id: "PVT_acme_widgets_roadmap", number: 7, title: "Widgets Roadmap" };
    await saveTarget({ repo: "acme/widgets", org: "acme", projectNumber: 7, projectId: "PVT_acme_widgets_roadmap", projectTitle: "Widgets Roadmap" });
    await saveMapping(mapping);
    await q(`INSERT INTO issues (gh_node_id, number, title, state) VALUES ('I_widgets_1', 1, 'Old repo issue', 'open')`);
    await q(`INSERT INTO sync_state (key, value) VALUES ('issues.since', '2026-11-01T00:00:00Z'), ('project.scanCursor', 'old-cursor')`);
  });

  it("switching to another repository drops the old cache and cursors", async () => {
    await chooseProject({ repo: "acme/gadgets", org: "acme", projectNumber: 7, mapping });
    expect(await q(`SELECT gh_node_id FROM issues`)).toEqual([]);
    expect(await q(`SELECT key FROM sync_state WHERE key IN ('issues.since', 'project.scanCursor')`)).toEqual([]);
    expect((await readTarget())?.repo).toBe("acme/gadgets");
    expect(await q(`SELECT id FROM project_fields`)).toEqual([{ id: "F_status" }]);
    expect(sync.requests).toEqual(["project"]);
  });

  it("switching project fails the GitHub edits still waiting for the old one", async () => {
    const { enqueueEdit, getEdit, PROJECT_CHANGED } = await import("@/lib/outbox/store");
    await q(`TRUNCATE outbox, audit_log`);
    const waiting = await enqueueEdit({ userId: "alice", issueNodeId: "I_widgets_1", op: "update", field: "status", base: null, next: "o_todo", idempotencyKey: "alice:old-project" });
    await chooseProject({ repo: "acme/gadgets", org: "acme", projectNumber: 7, mapping });
    expect(await getEdit(waiting.id)).toMatchObject({ status: "failed", error: PROJECT_CHANGED });
  });

  it("switching to another project in the same repository also starts over", async () => {
    projects.current = { id: "PVT_other_project", number: 8, title: "Other" };
    await chooseProject({ repo: "acme/widgets", org: "acme", projectNumber: 8, mapping });
    expect(await q(`SELECT gh_node_id FROM issues`)).toEqual([]);
  });

  it("a remap stops the running cycle and waits for its lock, so the cycle's remaining pages can't overwrite it", async () => {
    await chooseProject({ repo: "acme/widgets", org: "acme", projectNumber: 7, mapping });
    sync.requests = [];
    sync.interrupts = 0;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let done = false;
    // A cycle holds the sync lock.
    const cycle = withSyncLock(() => held);
    const run = remap(mapping).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 400));
    expect(sync.interrupts).toBe(1);
    expect(done).toBe(false);
    release();
    await cycle;
    await run;
    expect(done).toBe(true);
    // The stopped cycle is started again, with the new mapping.
    expect(sync.requests).toEqual(["project"]);
  });

  it("choosing the same project again keeps the cache", async () => {
    await chooseProject({ repo: "acme/widgets", org: "acme", projectNumber: 7, mapping });
    expect(await q(`SELECT gh_node_id FROM issues`)).toEqual([{ gh_node_id: "I_widgets_1" }]);
    expect(await q(`SELECT key FROM sync_state WHERE key = 'issues.since'`)).toEqual([{ key: "issues.since" }]);
  });
});
