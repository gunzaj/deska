// The API route wrapper (v5 4.1): auth, parsing, error shapes, cache headers, Origin check.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

let viewer: string | null = "alice";
vi.mock("@/lib/session", () => ({ getViewerLogin: async () => viewer }));

const { HttpError, route, originAllowed } = await import("@/lib/server/route");

const post = (body: unknown, headers: Record<string, string> = {}, url = "http://app.test/api/x") =>
  new NextRequest(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  viewer = "alice";
  delete process.env.CRON_SECRET;
  delete process.env.AUTH_URL;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("route()", () => {
  it("answers 401 JSON without a session and never runs the handler", async () => {
    viewer = null;
    const handler = vi.fn();
    const res = await route({ auth: "viewer" }, handler)(new NextRequest("http://app.test/api/x"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("hands the viewer, parsed body, query and params to the handler and sends its value as JSON", async () => {
    const POST = route(
      { auth: "viewer", body: z.object({ n: z.number() }), query: z.object({ q: z.string() }), params: z.object({ id: z.string() }) },
      ({ viewer, body, query, params }) => ({ viewer, n: body.n, q: query.q, id: params.id }),
    );
    const res = await POST(post({ n: 3 }, {}, "http://app.test/api/x?q=hi"), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ viewer: "alice", n: 3, q: "hi", id: "abc" });
  });

  it("a bad or missing body is a 400 with the label and at most 5 trimmed issues", async () => {
    const POST = route({ auth: "viewer", body: z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string(), f: z.string() }), invalid: "invalid thing" }, () => ({}));
    for (const req of [post({}), post("not json")]) {
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid thing");
      expect(body.issues.length).toBeLessThanOrEqual(5);
      expect(body.issues[0]).toEqual({ path: expect.any(Array), message: expect.any(String) });
    }
  });

  it("an HttpError answers with its status and text", async () => {
    const res = await route({ auth: "viewer" }, () => {
      throw new HttpError(404, "nothing here", { hint: "x" });
    })(new NextRequest("http://app.test/api/x"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "nothing here", hint: "x" });
  });

  it("any other error is a generic JSON 500 that leaks nothing, and is logged", async () => {
    const res = await route({ auth: "viewer" }, () => {
      throw new Error('relation "outbox" does not exist at db.internal:5432');
    })(new NextRequest("http://app.test/api/x"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal error" });
    expect(console.error).toHaveBeenCalled();
  });

  it("sets no-store unless the handler chose its own cache-control", async () => {
    const plain = await route({ auth: "viewer" }, () => ({}))(new NextRequest("http://app.test/api/x"));
    expect(plain.headers.get("cache-control")).toBe("no-store");
    const own = await route({ auth: "viewer" }, () => NextResponse.json({}, { headers: { "cache-control": "private, max-age=60" } }))(new NextRequest("http://app.test/api/x"));
    expect(own.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("refuses a cross-origin mutation, but not a same-origin one or one without Origin", async () => {
    const POST = route({ auth: "viewer" }, () => ({ ok: true }));
    const evil = await POST(post({}, { origin: "https://evil.example" }));
    expect(evil.status).toBe(403);
    expect((await POST(post({}, { origin: "null" }))).status).toBe(403);
    expect((await POST(post({}, { origin: "http://app.test" }))).status).toBe(200);
    expect((await POST(post({}))).status).toBe(200);
  });

  it("does not apply the Origin check to reads", async () => {
    const GET = route({ auth: "viewer" }, () => ({ ok: true }));
    const res = await GET(new NextRequest("http://app.test/api/x", { headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(200);
  });

  it("cron routes need the bearer secret and ignore the session", async () => {
    viewer = null;
    const GET = route({ auth: "cron" }, () => ({ ran: true }));
    const req = (auth?: string) => new NextRequest("http://app.test/api/x", { headers: auth ? { authorization: auth } : {} });
    expect((await GET(req())).status).toBe(401);
    process.env.CRON_SECRET = "s3cret";
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect((await GET(req("Bearer s3cret"))).status).toBe(200);
  });
});

describe("originAllowed()", () => {
  it("accepts the Host, X-Forwarded-Host and AUTH_URL hosts", () => {
    const req = (origin: string, headers: Record<string, string> = {}) => new NextRequest("http://internal:3000/api/x", { method: "POST", headers: { origin, ...headers } });
    expect(originAllowed(req("https://deska.example", { "x-forwarded-host": "deska.example" }))).toBe(true);
    expect(originAllowed(req("https://deska.example"))).toBe(false);
    process.env.AUTH_URL = "https://deska.example";
    expect(originAllowed(req("https://deska.example"))).toBe(true);
    expect(originAllowed(req("https://other.example"))).toBe(false);
  });
});
