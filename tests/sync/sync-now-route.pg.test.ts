// S11: /api/sync-now end to end against Postgres, with GitHub replaced by a
// fake GitHubSource through a module mock. Skipped without TEST_DATABASE_URL.
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

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("/api/sync-now (Postgres, fake GitHub)", async () => {
  const { getDb } = await import("@/db");
  const { GET, POST } = await import("@/app/api/sync-now/route");

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    process.env.GITHUB_TOKEN = "ghp_fake_token_for_route_tests_0000000000";
    process.env.CRON_SECRET = "cron-secret";
  });
  beforeEach(async () => {
    calls.checkChanges = 0;
    calls.scan = 0;
    await getDb().execute(sql`TRUNCATE issues, project_items, project_scan_seen, sync_state RESTART IDENTITY CASCADE`);
    await getDb().execute(sql`INSERT INTO sync_state (key, value) VALUES ('issues.since', '2026-10-01T00:00:00Z')`);
  });
  afterAll(() => {
    delete process.env.DATABASE_URL;
    delete process.env.GITHUB_TOKEN;
    delete process.env.CRON_SECRET;
  });

  const issueRows = async () => (await getDb().execute(sql`SELECT number FROM issues`)).rows.map((r) => r.number);

  it("POST (Sync now) runs a cycle into Postgres, then throttles", async () => {
    const res = await POST(new NextRequest("http://x/api/sync-now", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ issues: { applied: true, inserted: 1 }, source: "postgres" });
    expect(await issueRows()).toEqual([777]);
    expect(calls.scan).toBe(1);

    const again = await POST(new NextRequest("http://x/api/sync-now", { method: "POST" }));
    expect(await again.json()).toMatchObject({ skipped: "too-soon" });
    expect(calls.checkChanges).toBe(1);
  });

  it("GET with the cron secret runs; without it, 401 and no GitHub call", async () => {
    expect((await GET(new Request("http://x/api/sync-now"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/sync-now", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect(calls.checkChanges).toBe(0);

    const ok = await GET(new Request("http://x/api/sync-now", { headers: { authorization: "Bearer cron-secret" } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ issues: { applied: true } });
    expect(await issueRows()).toEqual([777]);
    // The cron is not throttled like the button.
    const again = await GET(new Request("http://x/api/sync-now", { headers: { authorization: "Bearer cron-secret" } }));
    expect((await again.json()).issues).toBeDefined();
  });

  it("no cursor: 503 asking for the initial import, GitHub untouched", async () => {
    await getDb().execute(sql`TRUNCATE sync_state`);
    const res = await GET(new Request("http://x/api/sync-now", { headers: { authorization: "Bearer cron-secret" } }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "needs initial import" });
    expect(calls.checkChanges).toBe(0);
  });
});
