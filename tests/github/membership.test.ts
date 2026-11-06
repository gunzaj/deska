import { afterEach, describe, expect, it, vi } from "vitest";
import { checkOrgMembership } from "@/lib/github/membership";

describe("org membership check under rate limits", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, headers: Record<string, string>) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "x" }), { status, headers })));

  it("a rate-limited 403 is unknown, so a member is not signed out", async () => {
    stub(403, { "x-ratelimit-remaining": "0" });
    expect(await checkOrgMembership("t", "acme")).toBeNull();
    stub(403, { "retry-after": "60" });
    expect(await checkOrgMembership("t", "acme")).toBeNull();
    stub(429, {});
    expect(await checkOrgMembership("t", "acme")).toBeNull();
  });

  it("a plain 403 is still a verdict", async () => {
    stub(403, { "x-ratelimit-remaining": "4999" });
    expect(await checkOrgMembership("t", "acme")).toBe(false);
  });
});
