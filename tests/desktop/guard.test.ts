// SPEC §2.2: the local server answers only the app window. Without the
// per-launch secret cookie, or for any Host but 127.0.0.1:<port>, it is 403.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { checkDesktopRequest, desktopGuard, LAUNCH_COOKIE } from "@/lib/desktop/guard";

const SECRET = "ab".repeat(32);
const HOST = "127.0.0.1:43123";
const ok = { host: HOST, cookie: SECRET, method: "GET", origin: null };

describe("checkDesktopRequest", () => {
  const guard = { secret: SECRET, host: HOST };

  it("admits the window: right Host and secret", () => {
    expect(checkDesktopRequest(guard, ok)).toBe("ok");
    expect(checkDesktopRequest(guard, { ...ok, method: "POST", origin: `http://${HOST}` })).toBe("ok");
  });

  it("refuses a missing or wrong secret", () => {
    expect(checkDesktopRequest(guard, { ...ok, cookie: undefined })).toBe("bad-secret");
    expect(checkDesktopRequest(guard, { ...ok, cookie: "" })).toBe("bad-secret");
    expect(checkDesktopRequest(guard, { ...ok, cookie: SECRET.slice(0, -1) + "c" })).toBe("bad-secret");
    expect(checkDesktopRequest(guard, { ...ok, cookie: SECRET + "0" })).toBe("bad-secret");
  });

  it("refuses any other Host, also localhost and the same port on another name (DNS rebinding)", () => {
    for (const host of [null, "localhost:43123", "127.0.0.1:43124", "127.0.0.1", "evil.example:43123", "[::1]:43123"]) {
      expect(checkDesktopRequest(guard, { ...ok, host }), String(host)).toBe("bad-host");
    }
  });

  it("refuses a mutation from another origin", () => {
    expect(checkDesktopRequest(guard, { ...ok, method: "POST", origin: "http://evil.example" })).toBe("bad-origin");
    expect(checkDesktopRequest(guard, { ...ok, method: "DELETE", origin: "null" })).toBe("bad-origin");
  });

  it("fails closed when main sent no secret or no host", () => {
    expect(checkDesktopRequest({ secret: "", host: HOST }, { ...ok, cookie: "" })).toBe("bad-secret");
    expect(checkDesktopRequest({ secret: "short", host: HOST }, { ...ok, cookie: "short" })).toBe("bad-secret");
    expect(checkDesktopRequest({ secret: SECRET, host: "" }, { ...ok, host: "" })).toBe("bad-host");
  });

  it("is off outside the desktop app", () => {
    expect(desktopGuard({})).toBeNull();
    expect(desktopGuard({ DESKA_DESKTOP: "1" })).toEqual({ secret: "", host: "" });
  });
});

describe("middleware in the desktop app", async () => {
  const { middleware } = await import("@/middleware");
  const req = (path: string, opts: { host?: string; cookie?: string; method?: string; origin?: string } = {}) => {
    const headers = new Headers({ host: opts.host ?? HOST });
    if (opts.cookie !== undefined) headers.set("cookie", `${LAUNCH_COOKIE}=${opts.cookie}`);
    if (opts.origin) headers.set("origin", opts.origin);
    return new NextRequest(new URL(path, `http://${opts.host ?? HOST}`), { headers, method: opts.method ?? "GET" });
  };

  beforeEach(() => {
    Object.assign(process.env, { DESKA_DESKTOP: "1", DESKA_LAUNCH_SECRET: SECRET, DESKA_HOST: HOST });
  });
  afterEach(() => {
    for (const k of ["DESKA_DESKTOP", "DESKA_LAUNCH_SECRET", "DESKA_HOST"]) delete process.env[k];
  });

  it("403s pages, API calls and static files without the secret cookie", async () => {
    for (const path of ["/", "/issues", "/api/data", "/api/views", "/_next/static/chunks/main.js", "/favicon.ico", "/onboarding", "/api/connection"]) {
      const res = await middleware(req(path));
      expect(res.status, path).toBe(403);
      expect(await res.text()).toBe("Forbidden");
    }
  });

  it("403s a wrong Host even with the secret", async () => {
    const res = await middleware(req("/api/data", { host: "localhost:43123", cookie: SECRET }));
    expect(res.status).toBe(403);
  });

  it("lets the window through, pages with the CSP", async () => {
    const api = await middleware(req("/api/data", { cookie: SECRET }));
    expect(api.status).toBe(200);
    expect(api.headers.get("x-middleware-next")).toBe("1");
    const page = await middleware(req("/issues", { cookie: SECRET }));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("img-src 'self' data: https://github.com");
  });

  it("403s a cross-origin mutation even with the secret", async () => {
    const res = await middleware(req("/api/views", { cookie: SECRET, method: "POST", origin: "http://evil.example" }));
    expect(res.status).toBe(403);
  });
});
