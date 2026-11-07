// D9 (§4.4): the issue panel's children come live from GitHub, a page at a time,
// including children outside the cache and in other repositories.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSubIssuesPage } from "@/lib/server/sub-issues";

const TOKEN = ["github", "pat", "TEST", "KIDS", "0".repeat(24)].join("_");
const PINNED = { projectId: "PVT_acme_widgets_roadmap", statusFieldId: "PVTSSF_acme_status" };

const child = (n: number, over: Record<string, unknown> = {}) => ({
  id: `I_kid_${n}`, number: n, title: `Child ${n}`, state: "OPEN", stateReason: null, url: `https://github.com/acme/widgets/issues/${n}`,
  repository: { nameWithOwner: "acme/widgets" }, projectItems: { nodes: [] }, ...over,
});

let queries: { query: string; variables: Record<string, unknown> }[];
beforeEach(() => {
  process.env.DESKA_GITHUB_API_URL = "http://127.0.0.1:9";
  queries = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DESKA_GITHUB_API_URL;
});

const stub = (pages: unknown[]) => {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      queries.push(JSON.parse(String(init?.body)));
      const body = pages[Math.min(i++, pages.length - 1)];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
};
const conn = (nodes: unknown[], next: string | null, totalCount = 3) => ({ data: { repository: { issue: { subIssues: { totalCount, pageInfo: { hasNextPage: next != null, endCursor: next }, nodes } } } } });

describe("fetchSubIssuesPage", () => {
  it("returns number, title, state, link and the Status in the pinned project; other repositories included", async () => {
    stub([
      conn(
        [
          child(11, { projectItems: { nodes: [{ project: { id: "OTHER_project" }, fieldValues: { nodes: [{ optionId: "zzz", field: { id: "PVTSSF_acme_status" } }] } }, { project: { id: PINNED.projectId }, fieldValues: { nodes: [{ optionId: "a0000003", field: { id: "PVTSSF_acme_team" } }, { optionId: "a0000002", field: { id: PINNED.statusFieldId } }] } }] } }),
          child(12, { state: "CLOSED", stateReason: "COMPLETED" }),
          child(7, { repository: { nameWithOwner: "acme/gadgets" }, url: "https://github.com/acme/gadgets/issues/7" }),
        ],
        null,
      ),
    ]);
    const page = await fetchSubIssuesPage(TOKEN, "acme/widgets", 100, null, PINNED);
    expect(page).toMatchObject({ total: 3, nextCursor: null });
    expect(page!.items.map((i) => [i.number, i.state, i.statusOptionId, i.repo])).toEqual([
      [11, "open", "a0000002", "acme/widgets"],
      [12, "closed", null, "acme/widgets"],
      [7, "open", null, "acme/gadgets"],
    ]);
    expect(page!.items[1]!.stateReason).toBe("completed");
    expect(page!.items[2]!.url).toBe("https://github.com/acme/gadgets/issues/7");
  });

  it("pages with GitHub's cursor and sends a read-only query", async () => {
    stub([conn([child(1)], "CURSOR_1", 2), conn([child(2)], null, 2)]);
    const first = await fetchSubIssuesPage(TOKEN, "acme/widgets", 100, null, PINNED);
    expect(first).toMatchObject({ nextCursor: "CURSOR_1", total: 2 });
    const second = await fetchSubIssuesPage(TOKEN, "acme/widgets", 100, first!.nextCursor, PINNED);
    expect(second!.items.map((i) => i.number)).toEqual([2]);
    expect(queries[1]!.variables).toMatchObject({ after: "CURSOR_1", number: 100, owner: "acme", name: "widgets" });
    for (const q of queries) expect(q.query.trimStart().startsWith("query")).toBe(true);
    for (const q of queries) expect(q.query).not.toMatch(/mutation/i);
  });

  it("skips the Status when no project or field is pinned", async () => {
    stub([conn([child(1, { projectItems: { nodes: [{ project: { id: PINNED.projectId }, fieldValues: { nodes: [{ optionId: "a0000002", field: { id: PINNED.statusFieldId } }] } }] } })], null, 1)]);
    const page = await fetchSubIssuesPage(TOKEN, "acme/widgets", 100, null, { projectId: null, statusFieldId: null });
    expect(page!.items[0]!.statusOptionId).toBeNull();
  });

  it("is null for an issue GitHub does not have", async () => {
    stub([{ data: { repository: { issue: null } } }]);
    expect(await fetchSubIssuesPage(TOKEN, "acme/widgets", 999, null, PINNED)).toBeNull();
  });
});
