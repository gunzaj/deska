// D6: sync makes no pull request calls. Every request the real GitHub clients
// send (change check, first-import pages, item scan, reconcile) is logged
// against a stubbed `fetch`, and none may touch pull requests: no REST
// `/pulls` path and no GraphQL query naming them. The REST issues endpoint
// still lists pull requests among issues; those rows are skipped, not fetched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubTarget } from "@/lib/config";
import { EMPTY_FIELD_MAP } from "@/lib/sync/field-map";
import { GitHubImportSource, githubReconcileSource } from "@/lib/sync/live";
import { GitHubSource } from "@/lib/sync/source-github";

const TOKEN = ["github", "pat", "TEST", "NOPR", "0".repeat(24)].join("_");

const issueRow = (n: number, pr = false) => ({
  id: n,
  node_id: pr ? `PR_${n}` : `I_${n}`,
  number: n,
  title: pr ? "A pull request" : `Issue ${n}`,
  body: "",
  state: "open",
  state_reason: null,
  html_url: `https://github.com/acme/widgets/${pr ? "pull" : "issues"}/${n}`,
  user: { login: "alice" },
  labels: [],
  assignees: [],
  milestone: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  closed_at: null,
  ...(pr ? { pull_request: { url: `https://api.github.com/repos/acme/widgets/pulls/${n}` } } : {}),
});

type Logged = { method: string; path: string; query: string };
let log: Logged[];

beforeEach(() => {
  process.env.DESKA_GITHUB_API_URL = "http://127.0.0.1:9";
  log = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { query?: string }) : {};
      log.push({ method: init?.method ?? "GET", path: url.pathname, query: body.query ?? "" });
      const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname === "/graphql") {
        const empty = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [], totalCount: 0 };
        return json({ data: { nodes: [], repository: { issues: empty, issueTypes: empty, labels: empty }, organization: { issueTypes: empty, projectV2: null }, node: null } });
      }
      if (url.pathname === "/repos/acme/widgets/issues") return json([issueRow(1), issueRow(2, true)]);
      return json([]);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DESKA_GITHUB_API_URL;
});

/** Run a call for its requests; a canned response it can't use is fine here. */
const attempt = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch {
    // The request log is what this test checks.
  }
};

describe("sync request log (D6)", () => {
  it("never asks GitHub for pull requests", async () => {
    const target = githubTarget();
    const source = new GitHubSource(TOKEN, undefined, EMPTY_FIELD_MAP, target);
    const check = await source.checkChanges(null, null);
    // The pull request the issues endpoint returned is skipped, not imported.
    expect(check.kind === "changed" ? check.issues.map((i) => i.number) : null).toEqual([1]);
    await attempt(() => source.scanProjectItems(null));

    const importer = new GitHubImportSource(TOKEN, target, EMPTY_FIELD_MAP);
    const page = await importer.issuesPage("open", null, 1);
    expect(page.issues.map((i) => i.number)).toEqual([1]);
    await attempt(() => importer.fetchMetadata());
    await attempt(() => importer.listAssignableUsers());

    const reconcile = githubReconcileSource(TOKEN, { labelId: (n) => n, userId: (l) => l, milestoneId: () => null }, EMPTY_FIELD_MAP, target);
    await attempt(() => reconcile.listOpenNodeIds());
    await attempt(() => reconcile.fetchNodes(["I_1"]));

    expect(log.some((r) => r.path === "/repos/acme/widgets/issues")).toBe(true);
    expect(log.some((r) => r.path === "/graphql")).toBe(true);
    for (const r of log) {
      expect(r.method === "GET" || r.path === "/graphql", `${r.method} ${r.path}`).toBe(true);
      expect(r.path).not.toMatch(/\/pulls\b/);
      expect(r.query).not.toMatch(/pullRequest|PullRequest|reviewRequests|team\(/);
    }
  });
});
