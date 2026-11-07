// S11: /api/sync-now end to end against Postgres, with GitHub replaced by a
// fake GitHubSource through a module mock. Runs on in-memory PGlite (tests/setup/db.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";

// Anything that slipped past the fakes hits a closed local port, never GitHub.
process.env.DESKA_GITHUB_API_URL = "http://127.0.0.1:10";

const calls = vi.hoisted(() => ({ checkChanges: 0, scan: 0, imported: 0 }));
// The POST route checks the session (defense-in-depth); supply a viewer.
vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));
vi.mock("@/lib/sync/source-github", async (orig) => {
  const real = await orig<typeof import("@/lib/sync/source-github")>();
  class FakeGitHubSource {
    constructor(_token: string, _ids?: unknown) {}
    async checkChanges() {
      calls.checkChanges++;
      return {
        kind: "changed" as const,
        issues: [
          {
            nodeId: "I_route",
            number: 777,
            title: "Arrived through the route",
            body: "",
            state: "open",
            stateReason: null,
            milestoneId: null,
            authorLogin: "alice",
            url: "https://github.com/acme/widgets/issues/777",
            createdAt: "2026-10-13T08:00:00Z",
            updatedAt: "2026-10-13T08:00:00Z",
            closedAt: null,
            labelIds: [],
            assigneeIds: [],
          },
        ],
        items: [],
        etag: "e1",
        since: "2026-10-13T08:00:00Z",
      };
    }
    async scanProjectItems() {
      calls.scan++;
      return { items: [], nextCursor: null, total: 0 };
    }
  }
  return { ...real, GitHubSource: FakeGitHubSource };
});
vi.mock("@/lib/sync/live", async (orig) => {
  const real = await orig<typeof import("@/lib/sync/live")>();
  // The first import, from a fake GitHub with no issues.
  class FakeImportSource {
    async fetchMetadata() {
      calls.imported++;
      return { projectId: "PVT_acme_widgets_roadmap", fields: [], issueTypes: [], labels: [], milestones: [] };
    }
    async listAssignableUsers() {
      return [];
    }
    async issuesPage() {
      return { issues: [], users: [], full: false, maxUpdatedAt: null };
    }
    async scanProjectItems() {
      return { items: [], nextCursor: null, total: 0 };
    }
  }
  const reconcileSource = () => ({
    fetchMetadata: async () => ({ projectId: "PVT_acme_widgets_roadmap", fields: [], issueTypes: [], labels: [], milestones: [] }),
    listOpenNodeIds: async () => ({ issues: [] }),
    fetchNodes: async () => new Map(),
    repoName: "acme/widgets",
  });
  return { ...real, GitHubImportSource: FakeImportSource, githubReconcileSource: reconcileSource };
});

describe("/api/sync-now (Postgres, fake GitHub)", async () => {
  const { getDb } = await import("@/db");
  const { POST } = await import("@/app/api/sync-now/route");
  const { setLocalToken } = await import("@/lib/github/local-token");
  const { resetSyncService } = await import("@/lib/sync/service");
  const post = () => POST(new NextRequest("http://x/api/sync-now", { method: "POST" }));

  beforeAll(() => {
    // The token the desktop main process would hand over (in memory only).
    setLocalToken("fake-token-for-route-tests", "launch");
  });
  beforeEach(async () => {
    calls.checkChanges = 0;
    calls.scan = 0;
    calls.imported = 0;
    await resetSyncService();
    await getDb().execute(sql`TRUNCATE issues, project_items, project_scan_seen, sync_state RESTART IDENTITY CASCADE`);
    await getDb().execute(sql`INSERT INTO sync_state (key, value) VALUES ('issues.since', '2026-10-01T00:00:00Z'), ('reconcile.lastRun', ${new Date().toISOString()})`);
  });
  afterAll(() => {
    setLocalToken(null, "launch");
  });

  const issueRows = async () => (await getDb().execute(sql`SELECT number FROM issues`)).rows.map((r) => r.number);

  it("POST (Sync now) runs a cycle into Postgres, then throttles", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ issues: { applied: true, inserted: 1 }, source: "postgres" });
    expect(await issueRows()).toEqual([777]);
    expect(calls.scan).toBe(1);

    const again = await post();
    expect(await again.json()).toMatchObject({ skipped: "too-soon" });
    expect(calls.checkChanges).toBe(1);
  });

  it("without a connected token: 503 and no GitHub call", async () => {
    setLocalToken(null, "user");
    try {
      const res = await post();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "GitHub is not connected" });
      expect(calls.checkChanges).toBe(0);
    } finally {
      setLocalToken("fake-token-for-route-tests", "launch");
    }
  });

  it("no cursor yet: Sync now runs the first import, not a poll of the whole history", async () => {
    await getDb().execute(sql`TRUNCATE sync_state`);
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ imported: { resumed: false } });
    expect(calls.imported).toBe(1);
    expect(calls.checkChanges).toBe(0);
    expect((await getDb().execute(sql`SELECT value FROM sync_state WHERE key = 'issues.since'`)).rows[0]).toBeTruthy();
  });
});
