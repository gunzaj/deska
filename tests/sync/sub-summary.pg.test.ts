// D9 (§4.4): GitHub's sub-issue counts are synced and stored per issue.
// Runs on an in-memory PGlite database (tests/setup/db.ts); GitHub is a stubbed `fetch`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

describe("sub-issue summary sync (Postgres)", async () => {
  const { getDb } = await import("@/db");
  const { issues } = await import("@/db/schema");
  const { importFull } = await import("@/lib/sync/import");
  const { MapKv, pollOnce } = await import("@/lib/sync/poll");
  const { reconcile } = await import("@/lib/sync/reconcile");
  const { PostgresStore, readSnapshot } = await import("@/lib/sync/store-postgres");
  const { githubTarget } = await import("@/lib/config");
  const { EMPTY_FIELD_MAP } = await import("@/lib/sync/field-map");
  const { GitHubSource } = await import("@/lib/sync/source-github");
  const { partialSnapshot } = await import("@/lib/sync/types");
  const { fixtureSnapshot } = await import("../fixtures/github");

  const TOKEN = ["github", "pat", "TEST", "SUMMARY", "0".repeat(24)].join("_");
  const row = async (nodeId: string) => (await getDb().select().from(issues).where(sql`${issues.ghNodeId} = ${nodeId}`))[0]!;
  const counts = async (nodeId: string) => {
    const r = await row(nodeId);
    return [r.subTotal, r.subCompleted, r.subSummaryAt != null] as const;
  };

  async function reset() {
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, tasks, task_links RESTART IDENTITY CASCADE`,
    );
    await importFull(fixtureSnapshot(), new PostgresStore());
  }
  beforeEach(reset);

  it("stores the counts the import carries and reads them back", async () => {
    expect(await counts("I_epic")).toEqual([1, 0, true]);
    // A child has no summary of its own in the fixture: not read.
    expect(await counts("I_sub")).toEqual([null, null, false]);
    const snap = await readSnapshot();
    const epic = snap.issues.find((i) => i.nodeId === "I_epic")!;
    expect([epic.subTotal, epic.subCompleted]).toEqual([1, 0]);
  });

  it("a payload without counts keeps what is stored; a new count replaces it", async () => {
    const base = fixtureSnapshot().issues.find((i) => i.nodeId === "I_epic")!;
    const { subTotal: _t, subCompleted: _c, ...rest } = base;
    await importFull(partialSnapshot({ issues: [{ ...rest, title: "Renamed epic" }] }), new PostgresStore());
    expect(await counts("I_epic")).toEqual([1, 0, true]);
    await importFull(partialSnapshot({ issues: [{ ...base, subTotal: 4, subCompleted: 2 }] }), new PostgresStore());
    expect(await counts("I_epic")).toEqual([4, 2, true]);
    // Counts that did not change do not make the row look changed again.
    const again = await importFull(partialSnapshot({ issues: [{ ...base, subTotal: 4, subCompleted: 2 }] }), new PostgresStore());
    expect(again.updated).toBe(0);
  });

  describe("poll: a child changes state, the parent follows", () => {
    const gqlCalls: string[] = [];
    beforeEach(() => {
      process.env.DESKA_GITHUB_API_URL = "http://127.0.0.1:9";
      gqlCalls.length = 0;
      const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json", etag: 'W/"2"' } });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
          if (url.pathname === "/repos/acme/widgets/issues") {
            // Only the child changed: it closed. The parent's own updated_at did not move.
            return json([
              {
                id: 101, node_id: "I_sub", number: 101, title: "Sub: dashboard widget", body: "Child", state: "closed", state_reason: "completed",
                html_url: "https://github.com/acme/widgets/issues/101", user: { login: "bob" }, labels: [], assignees: [], milestone: null,
                created_at: "2026-09-02T00:00:00Z", updated_at: "2026-10-20T00:00:00Z", closed_at: "2026-10-20T00:00:00Z",
              },
            ]);
          }
          const { query } = JSON.parse(String(init?.body)) as { query: string };
          gqlCalls.push(query);
          if (query.includes("DeskaIssueExtras")) return json({ data: { nodes: [{ id: "I_sub", issueType: { id: "IT_acme_task" }, parent: { id: "I_epic" }, subIssuesSummary: { total: 0, completed: 0 } }] } });
          // The parent by node ID (full row), with GitHub's fresh counts.
          return json({
            data: {
              nodes: [
                {
                  __typename: "Issue", id: "I_epic", number: 100, title: "Epic: dashboard overhaul", body: "Parent epic", state: "OPEN", stateReason: null,
                  url: "https://github.com/acme/widgets/issues/100", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", closedAt: null,
                  author: { login: "alice" }, issueType: { id: "IT_acme_feature" }, parent: null, subIssuesSummary: { total: 1, completed: 1 }, milestone: null,
                  labels: { nodes: [] }, assignees: { nodes: [] }, repository: { nameWithOwner: "acme/widgets" },
                },
              ],
            },
          });
        }),
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.DESKA_GITHUB_API_URL;
    });

    it("refreshes the parent's counts although the parent was not in the change list", async () => {
      expect(await counts("I_epic")).toEqual([1, 0, true]);
      const ids = { labelId: async (n: string) => n, userId: async (l: string) => l, milestoneId: async () => null };
      const source = new GitHubSource(TOKEN, ids, EMPTY_FIELD_MAP, githubTarget());
      const kv = new MapKv();
      kv.set("issues.since", "2026-10-01T00:00:00Z");
      const res = await pollOnce(source, new PostgresStore(), kv, "2026-10-20T01:00:00Z");
      expect(res.applied).toBe(true);
      expect((await row("I_sub")).state).toBe("closed");
      expect(await counts("I_epic")).toEqual([1, 1, true]);
      // One query for the changed child's extras, one for its parent.
      expect(gqlCalls).toHaveLength(2);
    });

    it("leaves a parent in another repository out", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
          const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
          if (url.pathname === "/repos/acme/widgets/issues") {
            return json([{ id: 101, node_id: "I_sub", number: 101, title: "t", body: "", state: "closed", state_reason: "completed", html_url: "https://github.com/acme/widgets/issues/101", user: { login: "bob" }, labels: [], assignees: [], milestone: null, created_at: "2026-09-02T00:00:00Z", updated_at: "2026-10-20T00:00:00Z", closed_at: "2026-10-20T00:00:00Z" }]);
          }
          const { query } = JSON.parse(String(init?.body)) as { query: string };
          if (query.includes("DeskaIssueExtras")) return json({ data: { nodes: [{ id: "I_sub", issueType: null, parent: { id: "I_elsewhere" }, subIssuesSummary: null }] } });
          return json({ data: { nodes: [{ __typename: "Issue", id: "I_elsewhere", number: 5, title: "x", body: "", state: "OPEN", stateReason: null, url: "https://github.com/other/repo/issues/5", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", closedAt: null, author: null, issueType: null, parent: null, subIssuesSummary: { total: 1, completed: 1 }, milestone: null, labels: { nodes: [] }, assignees: { nodes: [] }, repository: { nameWithOwner: "other/repo" } }] } });
        }),
      );
      const ids = { labelId: async (n: string) => n, userId: async (l: string) => l, milestoneId: async () => null };
      const source = new GitHubSource(TOKEN, ids, EMPTY_FIELD_MAP, githubTarget());
      const check = await source.checkChanges("2026-10-01T00:00:00Z", null);
      expect(check.kind === "changed" ? check.issues.map((i) => i.number) : null).toEqual([101]);
    });
  });

  describe("reconcile refreshes the counts", () => {
    const REPO = "acme/widgets";
    const snap = fixtureSnapshot();
    const source = (summaries: Record<string, { subTotal: number | null; subCompleted: number | null }>) => ({
      repoName: REPO,
      fetchMetadata: vi.fn(async () => ({ projectId: snap.projectId, fields: snap.fields, issueTypes: snap.issueTypes, labels: snap.labels, milestones: snap.milestones })),
      listOpenNodeIds: vi.fn(async () => ({ issues: snap.issues.filter((i) => !i.isPullRequest && i.state === "open").map((i) => i.nodeId) })),
      fetchNodes: vi.fn(async () => new Map()),
      fetchSubSummaries: vi.fn(async (ids: string[]) => new Map(ids.flatMap((id) => (summaries[id] ? [[id, summaries[id]!] as const] : [])))),
    });

    it("writes only the counts that changed, and a child added since the last poll shows up", async () => {
      const src = source({ I_epic: { subTotal: 3, subCompleted: 1 }, I_sub: { subTotal: 0, subCompleted: 0 } });
      await reconcile(src, new PostgresStore(), new MapKv(), { closedCutoff: "2026-07-15T00:00:00Z", now: new Date("2026-10-13T03:00:00Z") });
      expect(await counts("I_epic")).toEqual([3, 1, true]);
      // A child that never had a summary now has one (0 children): read, no children.
      expect(await counts("I_sub")).toEqual([0, 0, true]);
      const asked = src.fetchSubSummaries.mock.calls.flatMap((c) => c[0]);
      expect(asked).toContain("I_epic");
      // A second run with the same answers writes nothing.
      const before = (await row("I_epic")).subSummaryAt;
      await reconcile(src, new PostgresStore(), new MapKv(), { closedCutoff: "2026-07-15T00:00:00Z", now: new Date("2026-10-13T03:00:00Z") });
      expect((await row("I_epic")).subSummaryAt).toEqual(before);
    });

    it("a source without summaries leaves the stored counts alone", async () => {
      const { fetchSubSummaries: _f, ...plain } = source({});
      await reconcile(plain, new PostgresStore(), new MapKv(), { closedCutoff: "2026-07-15T00:00:00Z", now: new Date("2026-10-13T03:00:00Z") });
      expect(await counts("I_epic")).toEqual([1, 0, true]);
    });
  });
});
