// SPEC §4.1: the sync imports project fields as a complete list, so a field on a
// later page must not be dropped (it would be marked missing and lose its
// values). Issue types are paged the same way.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubTarget } from "@/lib/config";
import { fetchRepoMetadata } from "@/lib/sync/live";

const TOKEN = ["github", "pat", "TEST", "META", "0".repeat(24)].join("_");

const field = (i: number) => ({ id: `F_${i}`, name: `Field ${i}`, dataType: "SINGLE_SELECT", options: [{ id: `o_${i}`, name: "One", color: "GRAY" }] });
const type = (i: number) => ({ id: `IT_${i}`, name: `Type ${i}`, color: "GRAY", description: "" });

let queries: { query: string; after: unknown }[];

beforeEach(() => {
  process.env.DESKA_GITHUB_API_URL = "http://127.0.0.1:9";
  queries = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname !== "/graphql") return json([]);
      const body = JSON.parse(String(init?.body)) as { query: string; variables: { after?: string | null } };
      const after = body.variables.after ?? null;
      queries.push({ query: body.query.includes("DeskaSyncFields") ? "fields" : "types", after });
      if (body.query.includes("DeskaSyncFields")) {
        // 45 fields: 40 on the first page, 5 on the second.
        const nodes = after ? Array.from({ length: 5 }, (_, i) => field(40 + i)) : Array.from({ length: 40 }, (_, i) => field(i));
        return json({ data: { organization: { projectV2: { id: "PVT_acme_widgets_roadmap", fields: { pageInfo: { hasNextPage: !after, endCursor: after ? null : "c1" }, nodes } } } } });
      }
      const nodes = after ? [type(50), type(51)] : Array.from({ length: 50 }, (_, i) => type(i));
      return json({ data: { organization: { issueTypes: { pageInfo: { hasNextPage: !after, endCursor: after ? null : "t1" }, nodes } } } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DESKA_GITHUB_API_URL;
});

describe("sync metadata", () => {
  it("reads every page of project fields and issue types", async () => {
    const meta = await fetchRepoMetadata(TOKEN, githubTarget());
    expect(meta.projectId).toBe("PVT_acme_widgets_roadmap");
    expect(meta.fields).toHaveLength(45);
    expect(meta.fields.at(-1)).toMatchObject({ id: "F_44" });
    expect(meta.issueTypes).toHaveLength(52);
    expect(queries).toEqual([
      { query: "fields", after: null },
      { query: "fields", after: "c1" },
      { query: "types", after: null },
      { query: "types", after: "t1" },
    ]);
  });
});
