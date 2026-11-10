// SPEC §3.3, D15: the GitHub CLI's login as the token source. Each state has
// its own message and, where the user has something to run, the exact command.
// GitHub is mocked (msw): unhandled requests fail.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { checkToken, ghCliStatus, MESSAGES, missingProjectScope, parseScopes, writeScopesWarning, type CheckTarget } from "@/lib/github/connection";

// Obviously fake, and assembled at runtime so no token-shaped literal is committed.
const TOKEN = ["gho", `TESTFAKE${"0".repeat(28)}`].join("_");
const API = "https://api.github.com";
const TARGET: CheckTarget = { owner: "acme", repo: "widgets", org: "acme", projectNumber: 7 };
const NOW = new Date("2026-11-10T09:00:00Z");
const OAUTH_RESTRICTED = {
  message: "Although you appear to have the correct authorization credentials, the `acme` organization has enabled OAuth App access restrictions, meaning that data access to third-parties is limited.",
};

function github(scopes: string, over: { restricted?: boolean } = {}) {
  return [
    http.get(`${API}/user`, ({ request }) =>
      request.headers.get("authorization") === `Bearer ${TOKEN}`
        ? HttpResponse.json({ login: "alice", name: "Alice", avatar_url: null }, { headers: { "x-oauth-scopes": scopes } })
        : HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
    ),
    http.get(`${API}/repos/acme/widgets`, () => (over.restricted ? HttpResponse.json(OAUTH_RESTRICTED, { status: 403 }) : HttpResponse.json({ full_name: "acme/widgets" }))),
    http.get(`${API}/repos/acme/widgets/issues`, () => (over.restricted ? HttpResponse.json(OAUTH_RESTRICTED, { status: 403 }) : HttpResponse.json([]))),
    http.post(`${API}/graphql`, async ({ request }) => {
      const { query } = (await request.json()) as { query: string };
      expect(query).not.toMatch(/\bmutation\b/);
      if (over.restricted) return HttpResponse.json({ data: { organization: null }, errors: [{ type: "FORBIDDEN", message: OAUTH_RESTRICTED.message }] });
      return HttpResponse.json(query.includes("projectV2") ? { data: { organization: { projectV2: { id: "PVT_acme_widgets_roadmap" } } } } : { data: { organization: { issueTypes: { totalCount: 3 } } } });
    }),
  ];
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const check = (opts: { writes?: boolean; target?: CheckTarget | null } = {}) => checkToken(TOKEN, opts.target === undefined ? TARGET : opts.target, { now: NOW, source: "gh", writes: opts.writes });

describe("GitHub CLI login states (SPEC §3.3)", () => {
  it("not installed and logged out each have their own message and the command to run", () => {
    const missing = ghCliStatus("not-found", NOW);
    expect(missing).toMatchObject({ state: "gh-not-found", source: "gh", message: "GitHub CLI isn't installed", command: "gh auth login", login: null });
    const out = ghCliStatus("logged-out", NOW);
    expect(out).toMatchObject({ state: "gh-logged-out", source: "gh", message: "GitHub CLI isn't logged in", command: "gh auth login" });
    expect(missing.message).not.toBe(out.message);
  });

  it("ok: gh's default scopes plus read:project connect; the scopes are listed and Settings says the login can write", async () => {
    server.use(...github("gist, read:org, read:project, repo"));
    const s = await check();
    expect(s).toMatchObject({ state: "ok", source: "gh", login: "alice", scopes: ["gist", "read:org", "read:project", "repo"], command: null });
    // `repo` can write: the write gate is what keeps Deska read-only (§3.1).
    expect(s.scopeWarning).toBe(MESSAGES.ghCanWrite(["gist", "repo"]));
    expect(s.scopeWarning).toContain("GitHub writes");
    expect(s.readOnly).toBe(true);
  });

  it("missing read:project: names the scope and the exact gh auth refresh command, before any project read", async () => {
    const seen: string[] = [];
    server.events.on("request:start", ({ request }) => seen.push(`${request.method} ${new URL(request.url).pathname}`));
    server.use(...github("gist, read:org, repo"));
    const s = await check();
    server.events.removeAllListeners();
    expect(s.state).toBe("missing-scope");
    expect(s.message).toBe("Your GitHub CLI login is missing the read:project scope");
    expect(s.command).toBe("gh auth refresh -h github.com -s read:project");
    expect(s.missing).toEqual(["read:project"]);
    expect(s.login).toBe("alice");
    expect(seen).toEqual(["GET /user"]);
    // Also before a project is chosen (onboarding step 1).
    server.use(...github("repo"));
    expect((await check({ target: null })).state).toBe("missing-scope");
  });

  it("with writes on, read:project is not enough: the command asks for project", async () => {
    server.use(...github("read:org, read:project, repo"));
    const s = await check({ writes: true });
    expect(s.state).toBe("missing-scope");
    expect(s.message).toBe("Your GitHub CLI login is missing the project scope");
    expect(s.command).toBe("gh auth refresh -h github.com -s project");
    server.use(...github("project, read:org, repo"));
    expect((await check({ writes: true })).state).toBe("ok");
    // `project` covers reading.
    expect((await check()).state).toBe("ok");
  });

  it("org not approving the GitHub CLI app: /user works, the org's resources are refused", async () => {
    server.use(...github("read:org, read:project, repo", { restricted: true }));
    const s = await check();
    expect(s.state).toBe("awaiting-approval");
    expect(s.message).toBe("Your org may need to approve the GitHub CLI app");
    expect(s.message).not.toBe(MESSAGES.awaitingApproval);
    expect(s.login).toBe("alice");
  });

  it("the same refusal with a pasted token keeps the token's wording", async () => {
    server.use(...github("read:project", { restricted: true }));
    const s = await checkToken(TOKEN, TARGET, { now: NOW });
    expect(s).toMatchObject({ state: "awaiting-approval", source: "token", message: MESSAGES.awaitingApproval });
  });

  it("a 401 is the invalid state, and nothing returned holds the token", async () => {
    server.use(http.get(`${API}/user`, () => HttpResponse.json({ message: "Bad credentials" }, { status: 401 })));
    const s = await check();
    expect(s).toMatchObject({ state: "invalid", source: "gh", message: MESSAGES.invalid });
    expect(JSON.stringify(s)).not.toContain(TOKEN);
  });

  it("every GitHub CLI state has its own message", () => {
    const all = [MESSAGES.ghNotFound, MESSAGES.ghLoggedOut, MESSAGES.ghMissingScope(["read:project"]), MESSAGES.ghNotApproved, MESSAGES.invalid, MESSAGES.awaitingApproval, MESSAGES.missing];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("scopes", () => {
  it("parses x-oauth-scopes; a fine-grained token has none", () => {
    expect(parseScopes("repo, read:org")).toEqual(["repo", "read:org"]);
    expect(parseScopes("")).toBeNull();
    expect(parseScopes(undefined)).toBeNull();
  });

  it("a login without classic scopes is not asked for one", () => {
    expect(missingProjectScope(null, false)).toBeNull();
    expect(missingProjectScope(["repo"], false)).toBe("read:project");
    expect(missingProjectScope(["read:project"], true)).toBe("project");
    expect(missingProjectScope(["project"], true)).toBeNull();
  });

  it("the write warning is worded for the source", () => {
    expect(writeScopesWarning("repo", "gh")).toBe(MESSAGES.ghCanWrite(["repo"]));
    expect(writeScopesWarning("repo")).toBe(MESSAGES.writeScopes(["repo"]));
    expect(writeScopesWarning("read:project, read:org", "gh")).toBeNull();
  });
});
