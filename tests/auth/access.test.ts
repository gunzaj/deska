import { afterEach, describe, expect, it, vi } from "vitest";
import { accessMode, canSignIn, decideAccess } from "@/lib/allowlist";
import { checkOrgMembership } from "@/lib/github/membership";

const H = 3600_000;
const now = Date.parse("2026-10-12T12:00:00Z");

describe("access decision (SPEC §14)", () => {
  it("allowlist mode works exactly as before", () => {
    const base = { mode: "allowlist" as const, allowlist: "alice,bob", now };
    expect(decideAccess({ ...base, login: "Alice" })).toBe("allow");
    expect(decideAccess({ ...base, login: "stranger", orgActive: true, orgCheckedAt: now })).toBe("deny");
    expect(decideAccess({ ...base, login: null })).toBe("deny");
  });

  it("org mode: an active member gets in; a non-member or pending member is denied", () => {
    const base = { mode: "org" as const, allowlist: "", now, recheck: 24 * H };
    expect(decideAccess({ ...base, login: "dev", orgActive: true, orgCheckedAt: now - H })).toBe("allow");
    expect(decideAccess({ ...base, login: "outsider", orgActive: false, orgCheckedAt: now - H })).toBe("deny");
  });

  it("org mode: a stale or missing check asks for a recheck", () => {
    const base = { mode: "org" as const, allowlist: "", now, recheck: 24 * H };
    expect(decideAccess({ ...base, login: "dev", orgActive: true, orgCheckedAt: now - 25 * H })).toBe("recheck");
    expect(decideAccess({ ...base, login: "dev" })).toBe("recheck");
  });

  it("org mode: the allowlist still works as an extra allow", () => {
    expect(decideAccess({ mode: "org", allowlist: "contractor", login: "contractor", now })).toBe("allow");
  });

  it("reads ACCESS_MODE strictly and gives sign-in hints per mode", () => {
    expect(accessMode("org")).toBe("org");
    expect(accessMode("ORG")).toBe("allowlist");
    expect(accessMode(undefined)).toBe("allowlist");
    expect(canSignIn("anyone", "org")).toBe(true);
  });
});

describe("org membership check", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it("active membership is a member; pending is not; 404 is not", async () => {
    stub(200, { state: "active" });
    expect(await checkOrgMembership("t", "acme")).toBe(true);
    stub(200, { state: "pending" });
    expect(await checkOrgMembership("t", "acme")).toBe(false);
    stub(404, { message: "Not Found" });
    expect(await checkOrgMembership("t", "acme")).toBe(false);
  });

  it("a GitHub outage is unknown, not a verdict", async () => {
    stub(502, {});
    expect(await checkOrgMembership("t", "acme")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await checkOrgMembership("t", "acme")).toBeNull();
  });
});
