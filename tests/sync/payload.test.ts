// S5 without a database: ETag/304 on /api/data.
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));
const { GET: data } = await import("@/app/api/data/route");
const { dataEtag, etagMatches } = await import("@/lib/server/data");

const req = (url: string, etag?: string) => new NextRequest(url, etag ? { headers: { "if-none-match": etag } } : undefined);

describe("ETags on the data APIs", () => {
  it("/api/data: the returned ETag gets a 304 with an empty body", async () => {
    const first = await data(req("http://x/api/data"));
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^".+-r-\d{4}-\d{2}-\d{2}(-[a-z0-9]+)?"$/); // no viewer in it (v5 3.7)
    expect(first.headers.get("cache-control")).toBe("private, no-cache");
    const second = await data(req("http://x/api/data", etag));
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect((await data(req("http://x/api/data", '"other"'))).status).toBe(200);
  });

  it("one build and one serialized body serve every viewer; the payload names no viewer (v5 3.7)", async () => {
    const a = await (await data(req("http://x/api/data"))).text();
    const b = await (await data(req("http://x/api/data"))).text();
    expect(a).toBe(b);
    const body = JSON.parse(a);
    expect(body.meta.viewer).toBe(""); // the browser fills in who is signed in
    expect(body.issues.length).toBeGreaterThan(0);
    const { loadClientData } = await import("@/lib/server/data");
    const first = await loadClientData();
    expect(first.json()).toBe(first.json()); // the same string, not a re-serialization
    expect(first.data()).toBe(first.data());
  });

  it("ETag helpers", () => {
    expect(dataEtag("7", true, "2026-10-13")).toBe('"7-w-2026-10-13"');
    expect(dataEtag("7", false, "2026-10-13", "no")).toBe('"7-r-2026-10-13-no"');
    expect(etagMatches('"a", W/"b"', '"b"')).toBe(true);
    expect(etagMatches("*", '"b"')).toBe(true);
    expect(etagMatches(null, '"b"')).toBe(false);
    expect(etagMatches('"c"', '"b"')).toBe(false);
  });
});
