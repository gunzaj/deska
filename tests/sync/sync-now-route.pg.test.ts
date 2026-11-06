// S11: /api/sync-now end to end against Postgres, with GitHub replaced by a
// fake GitHubSource through a module mock. Runs on in-memory PGlite (tests/setup/db.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";

const calls = vi.hoisted(() => ({ checkChanges: 0, scan: 0 }));
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
    async scanOpenPullRequests() {
      return [];
    }
    async teamMembers() {
      return [];
    }
  }
  return { ...real, GitHubSource: FakeGitHubSource };
});

describe("/api/sync-now (Postgres, fake GitHub)", async () => {
  const { getDb } = await import("@/db");
  const { POST } = await import("@/app/api/sync-now/route");
  const { setLocalToken } = await import("@/lib/github/local-token");
  const post = () => POST(new NextRequest("http://x/api/sync-now", { method: "POST" }));

  beforeAll(() => {
    // The token the desktop main process would hand over (in memory only).
    setLocalToken("fake-token-for-route-tests", "launch");
  });
  beforeEach(async () => {
    calls.checkChanges = 0;
    calls.scan = 0;
    await getDb().execute(sql`TRUNCATE issues, project_items, project_scan_seen, sync_state RESTART IDENTITY CASCADE`);
    await getDb().execute(sql`INSERT INTO sync_state (key, value) VALUES ('issues.since', '2026-10-01T00:00:00Z')`);
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

  it("no cursor: 503 asking for the initial import, GitHub untouched", async () => {
    await getDb().execute(sql`TRUNCATE sync_state`);
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "needs initial import" });
    expect(calls.checkChanges).toBe(0);
  });
});
