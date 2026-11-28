// Looking up an issue the cache doesn't hold (closed before the import window),
// end to end against Postgres with GitHub replaced by a fake GitHubSource.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";

// Anything that slipped past the fakes hits a closed local port, never GitHub.
process.env.DESKA_GITHUB_API_URL = "http://127.0.0.1:10";

const calls = vi.hoisted(() => ({ nodeId: 0, fetchNodes: 0 }));
vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));
vi.mock("@/lib/sync/source-github", async (orig) => {
  const real = await orig<typeof import("@/lib/sync/source-github")>();
  class FakeGitHubSource {
    repoName = "acme/widgets";
    async issueNodeId(number: number) {
      calls.nodeId++;
      return number === 4242 ? "I_old" : null;
    }
    async fetchNodes(ids: string[]) {
      calls.fetchNodes++;
      return new Map(
        ids.map((id) => [
          id,
          {
            kind: "issue" as const,
            repo: "acme/widgets",
            issue: {
              nodeId: id,
              number: 4242,
              title: "Closed long ago",
              body: "",
              state: "closed",
              stateReason: "completed",
              milestoneId: null,
              authorLogin: "alice",
              url: "https://github.com/acme/widgets/issues/4242",
              createdAt: "2020-01-01T08:00:00Z",
              updatedAt: "2020-02-01T08:00:00Z",
              closedAt: "2020-02-01T08:00:00Z",
              labelIds: [],
              assigneeIds: [],
            },
          },
        ]),
      );
    }
    async fetchProjectItem() {
      return null;
    }
  }
  return { ...real, GitHubSource: FakeGitHubSource };
});

describe("POST /api/issues/{n}/lookup (Postgres, fake GitHub)", async () => {
  const { getDb } = await import("@/db");
  const { POST } = await import("@/app/api/issues/[number]/lookup/route");
  const { setLocalToken } = await import("@/lib/github/local-token");
  const { invalidateReadCache } = await import("@/lib/store");
  const post = (n: string) => POST(new NextRequest(`http://x/api/issues/${n}/lookup`, { method: "POST" }), { params: Promise.resolve({ number: n }) });
  const numbers = async () => (await getDb().execute(sql`SELECT number FROM issues ORDER BY number`)).rows.map((r) => r.number);

  beforeAll(() => setLocalToken("fake-token-for-route-tests", "launch"));
  beforeEach(async () => {
    calls.nodeId = 0;
    calls.fetchNodes = 0;
    await getDb().execute(sql`TRUNCATE issues, project_items RESTART IDENTITY CASCADE`);
    invalidateReadCache();
  });
  afterAll(() => setLocalToken(null, "launch"));

  it("fetches an issue the cache doesn't hold, once", async () => {
    const res = await post("4242");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: true, cached: false });
    expect(await numbers()).toEqual([4242]);

    expect(await (await post("4242")).json()).toEqual({ found: true, cached: true });
    expect(calls.fetchNodes).toBe(1);
  });

  it("a number GitHub doesn't know (or a pull request's) writes nothing", async () => {
    expect(await (await post("5")).json()).toEqual({ found: false, reason: "not-found" });
    expect(await numbers()).toEqual([]);
  });

  it("refuses what isn't an issue number", async () => {
    expect((await post("abc")).status).toBe(400);
    expect((await post("0")).status).toBe(400);
    expect(calls.nodeId).toBe(0);
  });

  it("without a token: no GitHub call", async () => {
    setLocalToken(null, "user");
    try {
      expect(await (await post("4242")).json()).toEqual({ found: false, reason: "not-connected" });
      expect(calls.nodeId).toBe(0);
    } finally {
      setLocalToken("fake-token-for-route-tests", "launch");
    }
  });
});
