// The middleware outside the desktop guard (tests/desktop/guard.test.ts covers
// that): no sign-in, no allowlist (SPEC §2.5), pages get the CSP.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

const { middleware } = await import("@/middleware");

const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

describe("middleware", () => {
  it("has no sign-in or allowlist: API calls and pages pass to the routes, which check for the local user", async () => {
    const api = await middleware(req("/api/data"));
    expect(api.status).toBe(200);
    expect(api.headers.get("x-middleware-next")).toBe("1");
    const page = await middleware(req("/my"));
    expect(page.status).toBe(200);
    expect(page.headers.get("location")).toBeNull();
  });
});

describe("middleware CSP (v5 4.10)", () => {
  it("gives every page a fresh nonce in the CSP header and the request headers, and leaves API answers alone", async () => {
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
  });
});
