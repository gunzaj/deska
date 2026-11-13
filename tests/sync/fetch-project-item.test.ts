// SPEC §1.2: a project can be owned by a user, not only an organization.
// `fetchProjectItem` (the re-read after a write) must find the item on a
// user-owned project; otherwise the cache keeps the old value and the next
// write reports a false conflict. The stub answers like GraphQL: an owner's
// `login` comes back only when the query asks for it on that owner's type.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_FIELD_MAP } from "@/lib/sync/field-map";
import { syncFailure } from "@/lib/sync/health";
import { GitHubSource, ProjectNotFoundError } from "@/lib/sync/source-github";

const TOKEN = ["github", "pat", "TEST", "ITEM", "0".repeat(24)].join("_");

let ownerType: "Organization" | "User";

beforeEach(() => {
  process.env.DESKA_GITHUB_API_URL = "http://127.0.0.1:9";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      const owner = query.includes(`... on ${ownerType} { login }`) ? { login: "acme" } : {};
      return json({
        data: {
          node: {
            projectItems: {
              nodes: [{ id: "item-1", updatedAt: "2026-10-02T00:00:00Z", project: { number: 1, owner }, content: null, fieldValues: { nodes: [] } }],
            },
          },
        },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DESKA_GITHUB_API_URL;
});

const target = { repoFull: "acme/widgets", owner: "acme", repo: "widgets", org: "acme", projectNumber: 1 };

describe("fetchProjectItem", () => {
  it.each(["Organization", "User"] as const)("finds the item on a project owned by a %s", async (type) => {
    ownerType = type;
    const source = new GitHubSource(TOKEN, undefined, EMPTY_FIELD_MAP, target);
    const row = await source.fetchProjectItem("I_1");
    expect(row).toMatchObject({ itemId: "item-1", issueNodeId: "I_1" });
  });
});

describe("a project GitHub no longer finds", () => {
  it("is its own error, not a network problem", async () => {
    // A renamed or deleted owner: GitHub answers null, with no error.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { organization: null } }), { status: 200, headers: { "content-type": "application/json" } })));
    const source = new GitHubSource(TOKEN, undefined, EMPTY_FIELD_MAP, target);
    const err = await source.scanProjectItems(null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProjectNotFoundError);
    expect(syncFailure(err)).toBe("other");
  });

  it("only a failed fetch reads as offline, not every TypeError", () => {
    expect(syncFailure(new TypeError("fetch failed"))).toBe("offline");
    expect(syncFailure(new TypeError("Cannot read properties of null (reading 'projectV2')"))).toBe("other");
  });
});
