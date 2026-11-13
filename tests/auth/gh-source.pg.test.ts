// SPEC §2.3, D15: the GitHub CLI source on the server. A 401 asks main to read
// the token again exactly once; a missing token says why; switching source is
// a token change; the token reaches no log, API answer, database or backup.
// GitHub is mocked (msw); main is a stub on the channel the server entry uses.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { sql } from "drizzle-orm";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// Obviously fake, and assembled so no token-shaped literal is committed.
const STALE = ["gho", `TESTFAKE${"1".repeat(28)}`].join("_");
const FRESH = ["gho", `TESTFAKE${"2".repeat(28)}`].join("_");
const API = "https://api.github.com";

let userCalls: string[] = [];
const server = setupServer(
  http.get(`${API}/user`, ({ request }) => {
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    userCalls.push(token);
    return token === FRESH
      ? HttpResponse.json({ login: "alice", name: "Alice", avatar_url: null }, { headers: { "x-oauth-scopes": "read:org, read:project, repo" } })
      : HttpResponse.json({ message: "Bad credentials" }, { status: 401 });
  }),
  http.get(`${API}/repos/acme/widgets`, () => HttpResponse.json({ full_name: "acme/widgets" })),
  http.get(`${API}/repos/acme/widgets/issues`, () => HttpResponse.json([])),
  http.post(`${API}/graphql`, () => HttpResponse.json({ data: { organization: { projectV2: { id: "PVT_acme_widgets_roadmap" }, issueTypes: { totalCount: 1 } } } })),
);

const { getDb } = await import("@/db");
const { localToken, requestGhReread, setLocalToken, tokenAuth, tokenState } = await import("@/lib/github/local-token");
const { connectionStatus, noteSyncProblem, resetConnectionCache } = await import("@/lib/connection");
const { MESSAGES } = await import("@/lib/github/token-states");
const { getViewerLogin } = await import("@/lib/session");
const { GET: connectionRoute } = await import("@/app/api/connection/route");
const { installLogRedaction, redactSecrets } = await import("@/lib/redact");
const { exportLocalData } = await import("@/lib/backup/local-data");
const { NextRequest } = await import("next/server");

const DESKTOP = { DESKA_DESKTOP: "1", DESKA_LAUNCH_SECRET: "ab".repeat(32), DESKA_HOST: "127.0.0.1:43123" };
const MAIN = Symbol.for("deska.mainChannel");
const g = globalThis as Record<symbol, unknown>;

/** A stand-in for the main process: counts `gh-reread` questions and answers with `answer()`. */
function fakeMain(answer: () => void) {
  const asked: unknown[] = [];
  g[MAIN] = (msg: { type: string }) => {
    asked.push(msg);
    if (msg.type === "gh-reread") queueMicrotask(answer);
  };
  return asked;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(async () => {
  Object.assign(process.env, DESKTOP);
  userCalls = [];
  resetConnectionCache();
  g[Symbol.for("deska.githubTokenState")] = undefined;
  g[MAIN] = undefined;
  setLocalToken(null, "launch");
  await getDb().execute(sql`TRUNCATE sync_state`);
});
afterEach(() => {
  for (const k of Object.keys(DESKTOP)) delete process.env[k];
  g[MAIN] = undefined;
  setLocalToken(null, "launch");
  vi.restoreAllMocks();
});

const GH_OK = { source: "gh", cli: "ok" } as const;

describe("a 401 on the GitHub CLI's token (§2.3)", () => {
  it("re-reads the token once; the CLI's newer token connects", async () => {
    setLocalToken(STALE, "launch", GH_OK);
    const asked = fakeMain(() => setLocalToken(FRESH, "launch", GH_OK, true));
    const s = await connectionStatus();
    expect(s).toMatchObject({ state: "ok", source: "gh", login: "alice" });
    expect(asked).toEqual([{ type: "gh-reread" }]);
    expect(userCalls).toEqual([STALE, FRESH]);
  });

  it("re-reads once, then shows the invalid state: the same token again is not asked for twice", async () => {
    setLocalToken(STALE, "launch", GH_OK);
    const asked = fakeMain(() => setLocalToken(STALE, "launch", GH_OK, true));
    const s = await connectionStatus();
    expect(s).toMatchObject({ state: "invalid", source: "gh", message: MESSAGES.invalid });
    expect(asked).toHaveLength(1);
    // Asking again (the banner's poll, "Check again" without main) never re-reads a second time.
    expect((await connectionStatus({ refresh: true })).state).toBe("invalid");
    noteSyncProblem("invalid");
    expect(asked).toHaveLength(1);
  });

  it("the re-read finding the CLI logged out says so", async () => {
    setLocalToken(STALE, "launch", GH_OK);
    fakeMain(() => setLocalToken(null, "launch", { source: "gh", cli: "logged-out" }, true));
    expect(await connectionStatus()).toMatchObject({ state: "gh-logged-out", message: "GitHub CLI isn't logged in", command: "gh auth login" });
  });

  it("a sync cycle's 401 asks for the same single re-read", async () => {
    setLocalToken(STALE, "launch", GH_OK);
    const asked = fakeMain(() => setLocalToken(FRESH, "launch", GH_OK, true));
    noteSyncProblem("invalid");
    await vi.waitFor(() => expect(localToken()).toBe(FRESH));
    expect(asked).toHaveLength(1);
    expect((await connectionStatus()).state).toBe("ok");
  });

  it("a pasted token is never re-read", async () => {
    setLocalToken(STALE, "user");
    const asked = fakeMain(() => undefined);
    expect((await connectionStatus()).state).toBe("invalid");
    expect(await requestGhReread()).toBe(false);
    expect(asked).toEqual([]);
  });

  it("gives up when main does not answer", async () => {
    setLocalToken(STALE, "launch", GH_OK);
    const asked = fakeMain(() => undefined);
    expect(await requestGhReread(50)).toBe(false);
    expect(asked).toHaveLength(1);
  });
});

describe("the GitHub CLI source without a token (§3.3)", () => {
  it("gh missing and gh logged out each answer with their own state, never \"connect GitHub\"", async () => {
    setLocalToken(null, "launch", { source: "gh", cli: "not-found" });
    expect(await connectionStatus()).toMatchObject({ state: "gh-not-found", message: "GitHub CLI isn't installed", source: "gh" });
    setLocalToken(null, "launch", { source: "gh", cli: "logged-out" });
    expect(await connectionStatus()).toMatchObject({ state: "gh-logged-out", message: "GitHub CLI isn't logged in", source: "gh" });
    expect(userCalls).toEqual([]);
  });

  it("the user it last was keeps the app open over the cached data", async () => {
    setLocalToken(FRESH, "user", GH_OK);
    expect(await getViewerLogin()).toBe("alice");
    // Logged out of the CLI while Deska runs (seen on wake, or on "Check again").
    setLocalToken(null, "launch", { source: "gh", cli: "logged-out" });
    expect(await getViewerLogin()).toBe("alice");
    // "Disconnect GitHub" turns the source off: no user, onboarding.
    setLocalToken(null, "user", { source: "token" });
    expect(await getViewerLogin()).toBeNull();
    expect((await connectionStatus()).state).toBe("missing");
  });
});

describe("switching source (§3.4: counts as a token change)", () => {
  it("to the GitHub CLI and back are user token changes, each a new token generation", () => {
    const start = tokenState();
    expect(start.changedByUser).toBe(false);
    setLocalToken(FRESH, "user", GH_OK);
    expect(tokenAuth()).toEqual(GH_OK);
    expect(tokenState()).toMatchObject({ generation: start.generation + 1, changedByUser: true });
    setLocalToken(STALE, "user", { source: "token" });
    expect(tokenAuth()).toEqual({ source: "token" });
    expect(tokenState().generation).toBe(start.generation + 2);
  });

  it("another account arriving on a wake (gh auth switch) turns GitHub writes off; the same account does not", async () => {
    const { readWrites, resetSettingsCache, saveWrites } = await import("@/lib/settings");
    resetSettingsCache();
    // An earlier test's user token change is not part of this one.
    (await import("@/lib/writes/token-change")).takeTokenChange();
    // The same account as last time: the switch stays as the user left it.
    await getDb().execute(sql`INSERT INTO sync_state (key, value) VALUES ('github.login', 'alice')`);
    await saveWrites(true);
    setLocalToken(FRESH, "launch", GH_OK);
    expect((await connectionStatus({ refresh: true })).login).toBe("alice");
    expect(await readWrites()).toBe(true);
    // The install last saw bob; the CLI now answers as alice.
    await getDb().execute(sql`UPDATE sync_state SET value = 'bob' WHERE key = 'github.login'`);
    resetConnectionCache();
    await connectionStatus({ refresh: true });
    expect(await readWrites()).toBe(false);
    await saveWrites(false);
  });

  it("a re-read or a wake is not a user change", () => {
    setLocalToken(STALE, "launch", GH_OK);
    setLocalToken(FRESH, "launch", GH_OK, true);
    expect(tokenState()).toMatchObject({ changedByUser: false, afterReread: true });
    // The next token message is an ordinary one again.
    setLocalToken(FRESH, "launch", GH_OK);
    expect(tokenState().afterReread).toBe(false);
  });
});

describe("the GitHub CLI's token stays in memory (§2.3)", () => {
  it("never reaches the API answer, a log line, the database or an export", async () => {
    setLocalToken(FRESH, "user", GH_OK);
    const res = await connectionRoute(new NextRequest("http://127.0.0.1:43123/api/connection?refresh=1"));
    const body = await res.text();
    expect(body).toContain("alice");
    expect(body).not.toContain(FRESH);

    const lines: string[] = [];
    const fake = { log: (...a: unknown[]) => lines.push(a.map(String).join(" ")), info() {}, warn() {}, error: (...a: unknown[]) => lines.push(a.map(String).join(" ")), debug() {}, trace() {} } as unknown as Console;
    installLogRedaction(fake);
    fake.log(`gh auth token said ${FRESH}`);
    fake.error(new Error(`401 for ${STALE}`));
    expect(lines.join("\n")).not.toMatch(/gho_/);
    // An OAuth token that is not the one held is redacted by shape.
    expect(redactSecrets(`Authorization: Bearer ${STALE}`)).toBe("Authorization: Bearer [redacted]");

    const { rows } = await getDb().execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    let all = "";
    for (const { table_name } of rows as { table_name: string }[]) all += JSON.stringify((await getDb().execute(sql.raw(`SELECT * FROM "${table_name}"`))).rows);
    expect(all).toContain("alice");
    expect(all).not.toContain(FRESH);
    expect(JSON.stringify(await exportLocalData())).not.toContain(FRESH);
  });
});
