// The middleware's answers for denied and stale sessions (v5 2.8, 2.9).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ token: null as Record<string, unknown> | null }));
vi.mock("@/lib/session-token", () => ({ getSessionToken: async () => session.token, sameOriginUrl: () => new URL("http://localhost/") }));

const { middleware } = await import("@/middleware");

const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

describe("middleware", () => {
  beforeEach(() => {
    process.env.ALLOWED_GITHUB_LOGINS = "alice";
    delete process.env.ACCESS_MODE;
    delete process.env.WRITE_MODE;
    delete process.env.E2E_AUTH_BYPASS;
  });
  afterEach(() => {
    session.token = null;
    delete process.env.ALLOWED_GITHUB_LOGINS;
    delete process.env.WRITE_MODE;
  });

  it("answers a denied API call with JSON 403, and a denied page with the forbidden page (v5 2.9)", async () => {
    session.token = { login: "intruder" };
    const api = await middleware(req("/api/data"));
    expect(api.status).toBe(403);
    expect(api.headers.get("content-type")).toMatch(/application\/json/);
    expect(await api.json()).toEqual({ error: "forbidden" });

    const page = await middleware(req("/my"));
    expect(page.status).toBe(403);
    expect(page.headers.get("x-middleware-rewrite")).toContain("/forbidden");
  });

  it("lets an allowed session through", async () => {
    session.token = { login: "alice" };
    const res = await middleware(req("/api/data"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("sends a session issued under the other WRITE_MODE back to sign in (v5 2.8)", async () => {
    session.token = { login: "alice", scopeMode: "on" }; // signed in while writes were on
    process.env.WRITE_MODE = "off";
    const api = await middleware(req("/api/data"));
    expect(api.status).toBe(401);
    const page = await middleware(req("/my"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/signin");

    session.token = { login: "alice" }; // no record: read-only
    process.env.WRITE_MODE = "on";
    expect((await middleware(req("/api/data"))).status).toBe(401);
    process.env.WRITE_MODE = "off";
    expect((await middleware(req("/api/data"))).status).toBe(200);
  });
});

describe("middleware CSP (v5 4.10)", () => {
  it("gives every page a fresh nonce in the CSP header and the request headers, and leaves API answers alone", async () => {
    process.env.ALLOWED_GITHUB_LOGINS = "alice";
    session.token = { login: "alice" };
    const a = await middleware(req("/my"));
    const b = await middleware(req("/my"));
    const nonceOf = (csp: string | null) => /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
    expect(nonceOf(a.headers.get("content-security-policy"))).toBeTruthy();
    expect(nonceOf(a.headers.get("content-security-policy"))).not.toBe(nonceOf(b.headers.get("content-security-policy")));
    // Next.js reads the nonce from the request header the middleware overrides.
    expect(a.headers.get("x-middleware-override-headers")).toContain("content-security-policy");
    expect(a.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(a.headers.get("content-security-policy")));

    const api = await middleware(req("/api/data"));
    expect(api.headers.get("content-security-policy")).toBeNull();
    delete process.env.ALLOWED_GITHUB_LOGINS;
    session.token = null;
  });
});
