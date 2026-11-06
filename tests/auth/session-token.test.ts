import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { getSessionToken, sameOriginUrl } from "@/lib/session-token";

const SECRET = "test-secret-for-session-token";

async function requestWith(cookieName: string) {
  const token = await encode({ token: { login: "alice" }, secret: SECRET, salt: cookieName });
  return new NextRequest("https://deska.example/my", { headers: { cookie: `${cookieName}=${token}` } });
}

describe("session token in middleware", () => {
  afterEach(() => {
    delete process.env.AUTH_SECRET;
  });

  it("reads the __Secure- cookie Auth.js sets on https", async () => {
    // Regression: getToken() defaulted to the unprefixed cookie name (and salt),
    // so on an https deployment the middleware never saw a session.
    process.env.AUTH_SECRET = SECRET;
    const t = await getSessionToken(await requestWith("__Secure-authjs.session-token"));
    expect(t?.login).toBe("alice");
  });

  it("still reads the plain cookie used on http (local dev, e2e)", async () => {
    process.env.AUTH_SECRET = SECRET;
    const t = await getSessionToken(await requestWith("authjs.session-token"));
    expect(t?.login).toBe("alice");
  });

  it("returns null without a session cookie", async () => {
    process.env.AUTH_SECRET = SECRET;
    expect(await getSessionToken(new NextRequest("https://deska.example/my"))).toBeNull();
  });
});

describe("post-recheck redirect target", () => {
  const base = "https://deska.example/api/access/recheck?next=x";

  it("keeps same-origin paths with their query", () => {
    expect(sameOriginUrl("/views/v-1?s=abc", base).href).toBe("https://deska.example/views/v-1?s=abc");
  });

  it("refuses paths that parse as another host", () => {
    // Regression: only "//" was rejected, but URL parsing treats "\" as "/"
    // and drops tabs, so these redirected to https://evil.com/.
    for (const next of ["//evil.com", "/\\evil.com", "/\t/evil.com", "https://evil.com", "evil.com", null]) {
      expect(sameOriginUrl(next, base).href).toBe("https://deska.example/");
    }
  });
});
