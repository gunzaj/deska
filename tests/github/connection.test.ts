// SPEC §3.3: every token state, told apart from mocked GitHub responses (msw),
// each with its own message. No real GitHub is called: unhandled requests fail.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { checkToken, classify, writeScopesWarning, hhmm, MESSAGES, parseExpiration, permissionName, type CheckTarget, type ConnectionStatus } from "@/lib/github/connection";

// Obviously fake, and assembled at runtime so no token-shaped literal is committed.
const TOKEN = ["github", "pat", "TEST", "FAKE", "0".repeat(24)].join("_");
const API = "https://api.github.com";
const TARGET: CheckTarget = { owner: "acme", repo: "widgets", org: "acme", projectNumber: 7 };
const NOW = new Date("2026-11-06T09:00:00Z");
const TZ = "UTC";

const NOT_ACCESSIBLE = { message: "Resource not accessible by personal access token", documentation_url: "https://docs.github.com/rest" };

type Gql = { project?: "ok" | "forbidden" | "not-found" | "null"; issueTypes?: "ok" | "forbidden" };

/** Handlers for a token that can read everything, with overrides. */
function github(over: { user?: () => Response; repo?: () => Response; issues?: () => Response; gql?: Gql; writes?: boolean } = {}) {
  const gql = { project: "ok", issueTypes: "ok", ...over.gql } as Required<Gql>;
  // SPEC §3.3: a fine-grained token's write permissions are read with
  // read-only `viewerCan*` fields (W0's detection), never by writing.
  const canWrite = over.writes ?? false;
  return [
    http.get(`${API}/user`, ({ request }) => {
      // The check sends the token as a bearer, and nothing else.
      if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return HttpResponse.json({ message: "Bad credentials" }, { status: 401 });
      return over.user?.() ?? HttpResponse.json({ login: "carol", name: "Carol", avatar_url: "https://avatars.githubusercontent.com/u/3" });
    }),
    http.get(`${API}/repos/acme/widgets`, () => over.repo?.() ?? HttpResponse.json({ full_name: "acme/widgets", private: true })),
    http.get(`${API}/repos/acme/widgets/issues`, () => over.issues?.() ?? HttpResponse.json([])),
    http.post(`${API}/graphql`, async ({ request }) => {
      const { query } = (await request.json()) as { query: string };
      expect(query).not.toMatch(/\bmutation\b/);
      if (query.includes("viewerCanUpdate")) {
        return HttpResponse.json({
          data: {
            repository: { issues: { nodes: [{ viewerCanUpdate: canWrite, viewerCanLabel: canWrite, viewerCanAssign: canWrite, viewerCanClose: canWrite }] } },
            organization: { projectV2: { viewerCanUpdate: canWrite } },
          },
        });
      }
      if (query.includes("projectV2")) {
        if (gql.project === "forbidden") return HttpResponse.json({ data: { organization: { projectV2: null } }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }] });
        if (gql.project === "not-found") return HttpResponse.json({ data: { organization: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve to an Organization with the login of 'acme'." }] });
        if (gql.project === "null") return HttpResponse.json({ data: { organization: { projectV2: null } } });
        return HttpResponse.json({ data: { organization: { projectV2: { id: "PVT_acme_widgets_roadmap" } } } });
      }
      if (gql.issueTypes === "forbidden") return HttpResponse.json({ data: { organization: { issueTypes: null } }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }] });
      return HttpResponse.json({ data: { organization: { issueTypes: { totalCount: 3 } } } });
    }),
  ];
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const check = (target: CheckTarget | null = TARGET, token: string | null = TOKEN) => checkToken(token, target, { now: NOW, timeZone: TZ });

const statusOf = (s: ConnectionStatus, key: string) => s.permissions.find((p) => p.key === key)?.status;

describe("token states (SPEC §3.3)", () => {
  it("missing: no token stored, no request", async () => {
    const s = await check(TARGET, null);
    expect(s.state).toBe("missing");
    expect(s.message).toBe(MESSAGES.missing);
  });

  it("read-only token: works, every read permission granted, marked read-only", async () => {
    server.use(...github());
    const s = await check();
    expect(s).toMatchObject({ state: "ok", message: null, login: "carol", name: "Carol", readOnly: true, writeAccess: "no", missing: [] });
    expect(s.readOnlyMessage).toContain("can't write");
    expect(s.writeAccessMessage).toContain("Repository → Issues: Read and write");
    expect(s.writeAccessMessage).toContain("Organization → Projects: Read and write");
    expect(s.permissions.map((p) => [p.key, p.status])).toEqual([
      ["metadata", "granted"],
      ["issues", "granted"],
      ["projects", "granted"],
      ["issueTypes", "granted"],
    ]);
  });

  it("classic token: read-only scopes give no warning, a write scope names itself", async () => {
    expect(writeScopesWarning(undefined)).toBeNull();
    expect(writeScopesWarning("")).toBeNull();
    expect(writeScopesWarning("read:project, read:org")).toBeNull();
    expect(writeScopesWarning("read:project, repo")).toContain("(repo)");
    expect(writeScopesWarning("project, write:org")).toContain("project, write:org");
    server.use(...github({ user: () => HttpResponse.json({ login: "carol" }, { headers: { "x-oauth-scopes": "read:project, repo" } }) }));
    const s = await checkToken(TOKEN, TARGET, { now: NOW, timeZone: TZ });
    expect(s.state).toBe("ok");
    expect(s.scopeWarning).toContain("repo");
    // SPEC §3.4 part 1: `repo` writes issues but not project fields.
    expect(s).toMatchObject({ readOnly: true, writeAccess: "no" });
    expect(s.writeAccessMessage).toContain("Organization → Projects: Read and write");
  });

  it("classic token with repo and project scopes can write", async () => {
    server.use(...github({ user: () => HttpResponse.json({ login: "carol" }, { headers: { "x-oauth-scopes": "read:org, project, repo" } }) }));
    const s = await checkToken(TOKEN, TARGET, { now: NOW, timeZone: TZ });
    expect(s).toMatchObject({ state: "ok", readOnly: false, readOnlyMessage: null, writeAccess: "yes", writeAccessMessage: null });
  });

  it("a fine-grained token's write permissions are detected with read-only viewerCan fields (W0)", async () => {
    server.use(...github({ writes: true }));
    const s = await check();
    expect(s).toMatchObject({ state: "ok", writeAccess: "yes", readOnly: false });
    // Read-only detection: the write check is a query, and the mock refuses mutations.
    const seen: string[] = [];
    server.events.on("request:start", ({ request }) => seen.push(`${request.method} ${new URL(request.url).pathname}`));
    server.use(...github());
    expect((await check()).writeAccess).toBe("no");
    expect(seen.filter((r) => r.startsWith("POST ")).every((r) => r === "POST /graphql")).toBe(true);
    server.events.removeAllListeners();
  });

  it("invalid / revoked / expired: 401", async () => {
    server.use(...github({ user: () => HttpResponse.json({ message: "Bad credentials" }, { status: 401 }) }));
    const s = await check();
    expect(s).toMatchObject({ state: "invalid", message: "Your GitHub token is invalid or expired", login: null });
  });

  it("expiring soon: the expiration header under 14 days gives a warning with the date", async () => {
    server.use(...github({ user: () => HttpResponse.json({ login: "carol" }, { headers: { "github-authentication-token-expiration": "2026-11-15 10:00:00 UTC" } }) }));
    const s = await check();
    expect(s.state).toBe("ok");
    expect(s.expiresAt).toBe("2026-11-15T10:00:00.000Z");
    expect(s.expiryWarning).toBe("Your GitHub token expires on 2026-11-15");
  });

  it("not expiring soon: the date is kept, no warning", async () => {
    server.use(...github({ user: () => HttpResponse.json({ login: "carol" }, { headers: { "github-authentication-token-expiration": "2027-02-01 10:00:00 +0000" } }) }));
    const s = await check();
    expect(s.expiresAt).toBe("2027-02-01T10:00:00.000Z");
    expect(s.expiryWarning).toBeNull();
  });

  it("awaiting org approval: GET /user works, the org's repository and project are refused", async () => {
    server.use(...github({ repo: () => HttpResponse.json({ message: "Not Found" }, { status: 404 }), issues: () => HttpResponse.json({ message: "Not Found" }, { status: 404 }), gql: { project: "not-found", issueTypes: "forbidden" } }));
    const s = await check();
    expect(s).toMatchObject({ state: "awaiting-approval", message: "Your org may still need to approve this token", login: "carol" });
  });

  it("awaiting org approval: an explicit org policy answer", async () => {
    server.use(
      ...github({
        repo: () => HttpResponse.json({ message: "The 'acme' organization forbids access via a fine-grained personal access tokens if the token's lifetime is greater than 90 days." }, { status: 403 }),
      }),
    );
    expect((await check()).state).toBe("awaiting-approval");
  });

  it("missing Projects read: names the permission (never an empty result)", async () => {
    server.use(...github({ gql: { project: "forbidden" } }));
    const s = await check();
    expect(s.state).toBe("missing-permission");
    expect(s.missing).toEqual(["Organization → Projects: Read"]);
    expect(s.message).toBe("This token is missing a permission: Organization → Projects: Read");
    expect(statusOf(s, "projects")).toBe("missing");
    expect(statusOf(s, "issues")).toBe("granted");
  });

  it("missing Issues read: names that permission", async () => {
    server.use(...github({ issues: () => HttpResponse.json(NOT_ACCESSIBLE, { status: 403 }) }));
    const s = await check();
    expect(s.state).toBe("missing-permission");
    expect(s.missing).toEqual([permissionName("issues")]);
    expect(s.message).toContain("Repository → Issues: Read");
  });

  it("the optional Issue types permission refused: still ok, Type is unavailable", async () => {
    server.use(...github({ gql: { issueTypes: "forbidden" } }));
    const s = await check();
    expect(s.state).toBe("ok");
    expect(statusOf(s, "issueTypes")).toBe("unavailable");
  });

  it("a project number the org doesn't have counts as not readable", async () => {
    server.use(...github({ gql: { project: "null" } }));
    const s = await check();
    expect(s.state).toBe("missing-permission");
    expect(s.missing).toEqual(["Organization → Projects: Read"]);
  });

  it("offline: a network error", async () => {
    server.use(http.get(`${API}/user`, () => HttpResponse.error()));
    const s = await check();
    expect(s).toMatchObject({ state: "offline", message: "Can't reach GitHub" });
  });

  it("GitHub down: 5xx", async () => {
    server.use(...github({ user: () => HttpResponse.json({ message: "Server Error" }, { status: 502 }) }));
    expect((await check()).state).toBe("offline");
    server.resetHandlers();
    server.use(...github({ issues: () => HttpResponse.json({ message: "Server Error" }, { status: 503 }) }));
    const s = await check();
    expect(s.state).toBe("offline");
    // The owner is known even though a later call failed.
    expect(s.login).toBe("carol");
  });

  it("rate limited: 403 with no requests left, until the reset time", async () => {
    const reset = Math.floor(Date.parse("2026-11-06T09:42:00Z") / 1000);
    server.use(
      ...github({
        user: () => HttpResponse.json({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } }),
      }),
    );
    const s = await check();
    expect(s).toMatchObject({ state: "rate-limited", message: "Rate limited until 09:42", rateLimitedUntil: "2026-11-06T09:42:00.000Z" });
  });

  it("rate limited: 429 with retry-after", async () => {
    server.use(...github({ issues: () => HttpResponse.json({ message: "secondary rate limit" }, { status: 429, headers: { "retry-after": "120" } }) }));
    const s = await check();
    expect(s.state).toBe("rate-limited");
    expect(s.message).toBe(`Rate limited until ${hhmm(new Date(NOW.getTime() + 120_000), TZ)}`);
  });

  it("without a repository and project to check yet: identity only, permissions unchecked", async () => {
    server.use(...github());
    const s = await check(null);
    // Without a project there is no issue to ask GitHub about: not detected yet.
    expect(s).toMatchObject({ state: "ok", login: "carol", writeAccess: "unknown" });
    expect(s.permissions.every((p) => p.status === "unchecked")).toBe(true);
  });

  it("each state has its own message", () => {
    const messages = [MESSAGES.missing, MESSAGES.invalid, MESSAGES.awaitingApproval, MESSAGES.missingPermission(["X: Read"]), MESSAGES.offline, MESSAGES.rateLimited("10:00"), MESSAGES.expiring("2026-11-20"), MESSAGES.readOnly];
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe("the token never comes back", () => {
  it("not in the status, even when GitHub echoes it in an error", async () => {
    server.use(...github({ issues: () => HttpResponse.json({ message: `Resource not accessible by personal access token ${TOKEN}` }, { status: 403 }) }));
    const s = await check();
    expect(s.state).toBe("missing-permission");
    expect(JSON.stringify(s)).not.toContain(TOKEN);
    expect(JSON.stringify(s)).not.toMatch(/github_pat_[A-Za-z0-9_]{20,}/);
    expect(s.permissions.find((p) => p.key === "issues")?.detail).toContain("[redacted]");
  });

  it("only GETs and GraphQL queries are sent (the write check is a query too)", async () => {
    const seen: string[] = [];
    server.events.on("request:start", ({ request }) => seen.push(`${request.method} ${new URL(request.url).pathname}`));
    server.use(...github());
    await check();
    server.events.removeAllListeners();
    expect(seen.sort()).toEqual(["GET /repos/acme/widgets", "GET /repos/acme/widgets/issues", "GET /user", "POST /graphql", "POST /graphql", "POST /graphql"]);
    // Every REST call is a GET; the only POSTs are the GraphQL queries (never a mutation).
    expect(seen.filter((r) => r.startsWith("GET ")).length).toBe(3);
    expect(seen.filter((r) => r.startsWith("POST ")).every((r) => r === "POST /graphql")).toBe(true);
  });
});

describe("parsing", () => {
  it("reads GitHub's expiration header formats", () => {
    expect(parseExpiration("2026-11-20 10:00:00 UTC")?.toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(parseExpiration("2026-11-20 10:00:00 +0100")?.toISOString()).toBe("2026-11-20T09:00:00.000Z");
    expect(parseExpiration("soon")).toBeNull();
    expect(parseExpiration(null)).toBeNull();
  });

  it("classifies a 403 without a rate limit as a refusal, not a rate limit", () => {
    expect(classify({ status: 403, headers: { "x-ratelimit-remaining": "4999" }, data: NOT_ACCESSIBLE }, NOW).kind).toBe("denied");
    expect(classify({ status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" }, data: {} }, NOW).kind).toBe("rate-limited");
  });
});
