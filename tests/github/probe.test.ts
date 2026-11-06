import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  assertQueryOnly,
  createReadOnlyClient,
  formatReport,
  PROBE_CHECK_IDS,
  ProbeWriteRefused,
  probeOutputPaths,
  redact,
  runProbe,
} from "@/lib/github/probe";

// Built at runtime so no token-shaped string sits in the repo (leak guard).
const TOKEN = ["github", "pat", "11TEST0000000000000000_fakefakefakefakefake"].join("_");

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function mockFetch(handler: (url: string, init: RequestInit) => Response = () => jsonResponse(200, {})) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {}));
}

describe("probe client: read-only", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "post", "delete", "HEAD", "OPTIONS"])("rejects REST %s without sending it", async (method) => {
    const f = mockFetch();
    const c = createReadOnlyClient(TOKEN, f);
    await expect(c.rest(method, "/repos/acme/widgets/issues/1")).rejects.toBeInstanceOf(ProbeWriteRefused);
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects absolute and protocol-relative REST paths", async () => {
    const f = mockFetch();
    const c = createReadOnlyClient(TOKEN, f);
    await expect(c.rest("GET", "https://example.com/x")).rejects.toBeInstanceOf(ProbeWriteRefused);
    await expect(c.rest("GET", "//example.com/x")).rejects.toBeInstanceOf(ProbeWriteRefused);
    expect(f).not.toHaveBeenCalled();
  });

  it("sends REST GET to the GitHub API", async () => {
    const f = mockFetch();
    await createReadOnlyClient(TOKEN, f).rest("GET", "/user");
    expect(f).toHaveBeenCalledOnce();
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://api.github.com/user");
    expect(init?.method).toBe("GET");
  });

  it.each([
    ["named mutation", `mutation Close { closeIssue(input:{issueId:"x"}) { clientMutationId } }`],
    ["anonymous mutation", `mutation { deleteIssue(input:{issueId:"x"}) { clientMutationId } }`],
    ["mutation after a comment", `# just a query\nmutation { addComment(input:{}) { clientMutationId } }`],
    ["mutation after a query", `query A { viewer { login } } mutation B { deleteProjectV2Item(input:{}) { deletedItemId } }`],
    ["upper-case keyword", `MUTATION { deleteIssue(input:{}) { clientMutationId } }`],
    ["subscription", `subscription { issueUpdated { id } }`],
    ["leading whitespace", `   \n\tmutation { x }`],
    ["no operation keyword", `fragment F on Issue { id }`],
  ])("rejects a GraphQL %s without sending it", async (_label, doc) => {
    const f = mockFetch();
    const c = createReadOnlyClient(TOKEN, f);
    await expect(c.graphql(doc)).rejects.toBeInstanceOf(ProbeWriteRefused);
    expect(f).not.toHaveBeenCalled();
  });

  it.each([
    ["shorthand", `{ viewer { login } }`],
    ["named query", `query Me { viewer { login } }`],
    ["the word in a comment", `# no mutation here\nquery { viewer { login } }`],
    ["the word in a string", `query { search(query:"mutation", type:ISSUE, first:1) { issueCount } }`],
  ])("allows a GraphQL %s", async (_label, doc) => {
    expect(() => assertQueryOnly(doc)).not.toThrow();
    const f = mockFetch(() => jsonResponse(200, { data: {} }));
    await createReadOnlyClient(TOKEN, f).graphql(doc);
    expect(f).toHaveBeenCalledOnce();
  });

  it("can't be talked into a mutation by a string that closes early", () => {
    expect(() => assertQueryOnly(`query { a(x:"\\"") } mutation { b }`)).toThrow(ProbeWriteRefused);
  });
});

describe("runProbe", () => {
  const target = { owner: "acme", repo: "widgets", org: "acme", projectNumber: 7 };

  it("runs every check with GET or a query only, and records failures with status and message", async () => {
    const seen: { method: string; url: string; body?: string }[] = [];
    const f = mockFetch((url, init) => {
      seen.push({ method: String(init.method), url, body: init.body as string | undefined });
      const headers = { "github-authentication-token-expiration": "2026-12-01 00:00:00 UTC" };
      if (url.endsWith("/graphql")) {
        const { query } = JSON.parse(String(init.body));
        if (query.includes("projectV2")) {
          return jsonResponse(200, {
            data: { organization: { projectV2: null } },
            errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }],
          }, headers);
        }
        if (query.includes("issueTypes")) return jsonResponse(200, { data: { organization: { issueTypes: { nodes: [{ id: "IT_acme_bug" }] } } } }, headers);
        return jsonResponse(200, {
          data: { repository: { issue: { id: "I_1", number: 42, subIssuesSummary: { total: 4, completed: 2, percentCompleted: 50 } } } },
        }, headers);
      }
      if (url.includes("/issues?")) return jsonResponse(200, [{ number: 42 }], headers);
      if (url.endsWith("/milestones?state=all&per_page=5")) {
        return jsonResponse(403, { message: "Resource not accessible by personal access token" }, {
          ...headers,
          "x-accepted-github-permissions": "issues=read",
        });
      }
      return jsonResponse(200, [], headers);
    });

    const report = await runProbe(createReadOnlyClient(TOKEN, f), target, new Date("2026-11-06T10:00:00Z"));

    expect(report.checks.map((c) => c.id)).toEqual(PROBE_CHECK_IDS);
    expect(report.target.issueNumber).toBe(42);
    expect(report.tokenExpiration).toBe("2026-12-01 00:00:00 UTC");
    for (const s of seen) {
      if (s.method === "POST") {
        expect(s.url).toBe("https://api.github.com/graphql");
        expect(() => assertQueryOnly(JSON.parse(s.body!).query)).not.toThrow();
      } else {
        expect(s.method).toBe("GET");
      }
    }
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["issue-detail"]).toMatchObject({ ok: true, message: "subIssuesSummary.total=4" });
    expect(byId["project-fields"]).toMatchObject({ ok: false, status: 200 });
    expect(byId["project-fields"]!.message).toContain("FORBIDDEN: Resource not accessible by personal access token");
    expect(byId["milestones"]).toMatchObject({ ok: false, status: 403 });
    expect(byId["milestones"]!.message).toContain("accepted permissions: issues=read");
    expect(byId["comments"]).toMatchObject({ ok: true });
    expect(seen.some((s) => s.url.includes("/issues/42/comments"))).toBe(true);
  });

  it("records a network error and carries on", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const report = await runProbe(createReadOnlyClient(TOKEN, f), { ...target, issueNumber: 3 });
    expect(report.checks).toHaveLength(PROBE_CHECK_IDS.length);
    expect(report.checks.every((c) => !c.ok && c.status === null && c.message.includes("fetch failed"))).toBe(true);
  });

  it("never puts the token in the report", async () => {
    const f = mockFetch((url) => jsonResponse(401, { message: `Bad credentials for ${TOKEN}`, url }));
    const report = await runProbe(createReadOnlyClient(TOKEN, f), target);
    const text = redact(JSON.stringify(report) + formatReport(report), TOKEN);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toMatch(/github_pat_/);
    expect(text).toContain("[REDACTED]");
  });
});

describe("probe output", () => {
  it("goes to private/findings, which git ignores", () => {
    const out = probeOutputPaths("/repo/", "2026-11-06T10:00:00.000Z");
    expect(out.dir).toBe("/repo/private/findings");
    expect(out.json).toBe("/repo/private/findings/pat-probe-2026-11-06T10-00-00-000Z.json");
    const rel = out.json.replace("/repo/", "");
    // `git check-ignore` exits 0 when the path is ignored.
    expect(() => execFileSync("git", ["check-ignore", "-q", rel])).not.toThrow();
  });
});
