// SPEC §2.3, D3: the local user is the owner of the stored token (`me`), the
// token lives in memory only, and it never reaches the database, a log, an
// error payload or an API answer. GitHub is mocked (msw); runs on PGlite.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const TOKEN = ["github", "pat", "TEST", "FAKE", "1".repeat(24)].join("_");
const OTHER = ["github", "pat", "TEST", "FAKE", "2".repeat(24)].join("_");
const API = "https://api.github.com";

const owners: Record<string, string> = { [TOKEN]: "carol", [OTHER]: "dave" };
let down = false;

const server = setupServer(
  http.get(`${API}/user`, ({ request }) => {
    if (down) return HttpResponse.error();
    const login = owners[(request.headers.get("authorization") ?? "").replace(/^Bearer /, "")];
    return login ? HttpResponse.json({ login, name: null, avatar_url: null }) : HttpResponse.json({ message: "Bad credentials" }, { status: 401 });
  }),
  http.get(`${API}/repos/acme/widgets`, () => HttpResponse.json({ full_name: "acme/widgets" })),
  // GitHub echoing the token back must not leak it anywhere.
  http.get(`${API}/repos/acme/widgets/issues`, ({ request }) =>
    HttpResponse.json({ message: `Resource not accessible by personal access token (${request.headers.get("authorization")})` }, { status: 403 }),
  ),
  http.post(`${API}/graphql`, () => HttpResponse.json({ data: { organization: { projectV2: { id: "PVT_acme_widgets_roadmap" }, issueTypes: { totalCount: 1 } } } })),
);

const { getDb } = await import("@/db");
const { setLocalToken, localToken } = await import("@/lib/github/local-token");
const { connectionStatus, resetConnectionCache, savedIdentity } = await import("@/lib/connection");
const { getViewerLogin } = await import("@/lib/session");
const { GET: connectionRoute } = await import("@/app/api/connection/route");
const { route } = await import("@/lib/server/route");
const { installLogRedaction, redactSecrets } = await import("@/lib/redact");

const DESKTOP = { DESKA_DESKTOP: "1", DESKA_LAUNCH_SECRET: "ab".repeat(32), DESKA_HOST: "127.0.0.1:43123" };

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(async () => {
  Object.assign(process.env, DESKTOP);
  down = false;
  resetConnectionCache();
  (globalThis as Record<symbol, unknown>)[Symbol.for("deska.githubTokenState")] = undefined;
  setLocalToken(null, "launch");
  await getDb().execute(sql`TRUNCATE sync_state`);
});
afterEach(() => {
  for (const k of Object.keys(DESKTOP)) delete process.env[k];
  setLocalToken(null, "launch");
  vi.restoreAllMocks();
});

/** Every text value in the database, as one string. */
async function databaseText(): Promise<string> {
  const { rows } = await getDb().execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
  let all = "";
  for (const { table_name } of rows as { table_name: string }[]) {
    const r = await getDb().execute(sql.raw(`SELECT * FROM "${table_name}"`));
    all += JSON.stringify(r.rows);
  }
  return all;
}

describe("the local user is the PAT owner", () => {
  it("no token: no user (onboarding), and /api/connection says missing", async () => {
    expect(await getViewerLogin()).toBeNull();
    const res = await connectionRoute(new NextRequest("http://127.0.0.1:43123/api/connection"));
    expect(await res.json()).toMatchObject({ state: "missing", message: "Connect GitHub to get started" });
  });

  it("a connected token's owner is `me`, and is remembered for an offline relaunch", async () => {
    setLocalToken(TOKEN, "user");
    expect(await getViewerLogin()).toBe("carol");
    expect(await savedIdentity()).toMatchObject({ login: "carol" });

    // Relaunch: a fresh process gets the same stored token from main, GitHub is unreachable.
    resetConnectionCache();
    (globalThis as Record<symbol, unknown>)[Symbol.for("deska.githubTokenState")] = undefined;
    setLocalToken(TOKEN, "launch");
    down = true;
    expect(await getViewerLogin()).toBe("carol");
    expect((await connectionStatus()).state).toBe("offline");
  });

  it("a replaced token's owner becomes `me`; the old owner is not reused", async () => {
    setLocalToken(TOKEN, "user");
    expect(await getViewerLogin()).toBe("carol");
    setLocalToken(OTHER, "user");
    expect(await getViewerLogin()).toBe("dave");
  });

  it("a token GitHub refuses has no owner", async () => {
    setLocalToken(["github", "pat", "TEST", "REVOKED", "0".repeat(20)].join("_"), "user");
    expect(await getViewerLogin()).toBeNull();
    expect((await connectionStatus()).state).toBe("invalid");
  });

  it("disconnecting removes the user", async () => {
    setLocalToken(TOKEN, "user");
    expect(await getViewerLogin()).toBe("carol");
    setLocalToken(null, "user");
    expect(localToken()).toBeNull();
    expect(await getViewerLogin()).toBeNull();
  });
});

describe("the token never leaves memory", () => {
  it("not in the database, the API answer or an error payload", async () => {
    setLocalToken(TOKEN, "user");
    const res = await connectionRoute(new NextRequest("http://127.0.0.1:43123/api/connection?refresh=1"));
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ state: "missing-permission", login: "carol" });
    expect(body).not.toContain(TOKEN);
    expect(await databaseText()).not.toContain(TOKEN);

    // A handler that fails with the token in its error: a generic 500 out, a redacted log line.
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
    const failing = route({ auth: "public" }, () => {
      throw new Error(`GitHub said no to ${TOKEN}`);
    });
    const failed = await failing(new NextRequest("http://127.0.0.1:43123/api/x"));
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain(TOKEN);
    expect(logged.join("\n")).not.toContain(TOKEN);
  });

  it("log redaction catches the exact token and any github_pat_ string", () => {
    setLocalToken("plain-token-without-a-prefix-1234", "user");
    const lines: string[] = [];
    const fake = { log: (...a: unknown[]) => lines.push(a.map((x) => (x instanceof Error ? x.stack ?? x.message : typeof x === "string" ? x : JSON.stringify(x))).join(" ")) } as unknown as Console;
    for (const m of ["info", "warn", "error", "debug", "trace"] as const) (fake as unknown as Record<string, unknown>)[m] = fake.log;
    installLogRedaction(fake);
    fake.log("token is plain-token-without-a-prefix-1234");
    fake.warn(new Error(`bad ${TOKEN}`));
    fake.error({ nested: { value: `x ${OTHER} y` } });
    const out = lines.join("\n");
    for (const secret of ["plain-token-without-a-prefix-1234", TOKEN, OTHER]) expect(out).not.toContain(secret);
    expect(out).toContain("[redacted]");
    expect(redactSecrets("nothing secret here")).toBe("nothing secret here");
  });
});
