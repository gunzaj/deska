// The desktop app keeps its repository in Settings and sets no GITHUB_REPO
// (SPEC §2.4). The issue panel, task links and AI comments must use the stored
// repository, not throw or fall back to the demo label.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const fetched = vi.hoisted(() => ({ calls: [] as [number, string, string][] }));
vi.mock("@/lib/server/issue-detail", async (orig) => {
  const real = await orig<typeof import("@/lib/server/issue-detail")>();
  return {
    ...real,
    fetchIssueDetail: async (number: number, token: string, repo: string) => {
      fetched.calls.push([number, token, repo]);
      return { number, body: "", bodyHtml: null, comments: [], commentsError: null, source: "github" as const };
    },
  };
});

describe("the stored repository when GITHUB_REPO is unset", async () => {
  const { getDb } = await import("@/db");
  const { linkRepo, resetSettingsCache, saveTarget } = await import("@/lib/settings");
  const { setLocalToken } = await import("@/lib/github/local-token");
  const { invalidateReadCache } = await import("@/lib/store");
  const { detailResponse } = await import("@/lib/server/detail-route");
  const { withHtml, withBodyHtml } = await import("@/lib/tasks/http");

  const TOKEN = ["github", "pat", "LINKREPO", "FAKE", "0".repeat(24)].join("_");
  const saved = process.env.GITHUB_REPO;

  beforeEach(async () => {
    delete process.env.GITHUB_REPO;
    fetched.calls = [];
    await getDb().execute(sql`TRUNCATE app_settings, issues RESTART IDENTITY CASCADE`);
    resetSettingsCache();
    invalidateReadCache();
    await saveTarget({ repo: "acme/gadgets", org: "acme", projectNumber: 7, projectId: "PVT_other_project", projectTitle: "Gadgets" });
    setLocalToken(TOKEN, "launch");
  });
  afterEach(() => {
    process.env.GITHUB_REPO = saved;
    setLocalToken(null, "launch");
  });

  it("linkRepo is the stored repository", async () => {
    expect(await linkRepo()).toBe("acme/gadgets");
  });

  it("the issue panel asks GitHub for the stored repository instead of failing over to the cache", async () => {
    const res = await detailResponse("101");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: "github" });
    expect(fetched.calls).toEqual([[101, TOKEN, "acme/gadgets"]]);
  });

  it("#123 in task descriptions and comments links to the stored repository", async () => {
    const task = { description: "see #5" } as Parameters<typeof withHtml>[0];
    expect((await withHtml(task)).descriptionHtml).toContain("https://github.com/acme/gadgets/issues/5");
    const comment = { body: "see #6" } as Parameters<typeof withBodyHtml>[0];
    expect((await withBodyHtml(comment)).bodyHtml).toContain("https://github.com/acme/gadgets/issues/6");
  });
});
