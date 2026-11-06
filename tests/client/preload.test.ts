import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPreload, fetchPreloaded, PRELOAD_TTL_MS, preloadAppFetches } from "@/lib/client/preload";

describe("preloaded fetches (v5 3.9)", () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    __resetPreload();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ url }));
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts every store's first request at once, and hands each response over once", async () => {
    preloadAppFetches();
    expect(calls.sort()).toEqual(["/api/me/prefs", "/api/notifications", "/api/prs", "/api/tasks", "/api/triage/snoozes", "/api/watches"].sort());
    const before = calls.length;
    const res = await fetchPreloaded("/api/tasks", { cache: "no-store" });
    expect(await res.json()).toEqual({ url: "/api/tasks" });
    expect(calls.length).toBe(before); // taken, not fetched again
    await fetchPreloaded("/api/tasks"); // a second ask is a real request
    expect(calls.length).toBe(before + 1);
  });

  it("does not start a request twice", () => {
    preloadAppFetches();
    const n = calls.length;
    preloadAppFetches();
    expect(calls.length).toBe(n);
  });

  it("falls back to a normal request when the preload failed or went stale", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (calls.length <= 6) throw new Error("offline");
      return new Response("{}");
    }));
    preloadAppFetches();
    const res = await fetchPreloaded("/api/prs"); // the preload rejected
    expect(res.ok).toBe(true);

    __resetPreload();
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (calls.push(url), new Response("{}"))));
    preloadAppFetches(Date.now() - PRELOAD_TTL_MS - 1); // started long ago
    const n = calls.length;
    await fetchPreloaded("/api/watches");
    expect(calls.length).toBe(n + 1);
  });

  it("is a plain fetch for a URL that was never preloaded", async () => {
    await fetchPreloaded("/api/other");
    expect(calls).toEqual(["/api/other"]);
  });
});
