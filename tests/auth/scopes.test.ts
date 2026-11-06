import { describe, expect, it } from "vitest";
import { requestedScopes, scopeMatchesMode, scopeModeOf } from "@/lib/github/scopes";

describe("OAuth scopes", () => {
  it("requests only read scopes when writes are off", () => {
    const scopes = requestedScopes("off").split(" ");
    expect(scopes).toContain("read:user");
    expect(scopes).toContain("read:org");
    expect(scopes).toContain("read:project");
    // `public_repo` and `project` are write scopes — GitHub must be unable to
    // write on our behalf in read-only mode.
    expect(scopes).not.toContain("public_repo");
    expect(scopes).not.toContain("project");
  });

  it("treats an unset WRITE_MODE as read-only", () => {
    expect(requestedScopes(undefined)).toBe(requestedScopes("off"));
  });

  it("adds the write scopes only when explicitly enabled", () => {
    const scopes = requestedScopes("on").split(" ");
    expect(scopes).toContain("public_repo");
    expect(scopes).toContain("project");
  });

  it("sends a session issued under the other WRITE_MODE back to sign in (v5 2.8)", () => {
    expect(scopeModeOf("on")).toBe("on");
    expect(scopeModeOf("off")).toBe("off");
    expect(scopeModeOf(undefined)).toBe("off");
    expect(scopeMatchesMode({ scopeMode: "off" }, "off")).toBe(true);
    expect(scopeMatchesMode({ scopeMode: "on" }, "on")).toBe(true);
    expect(scopeMatchesMode({ scopeMode: "on" }, "off")).toBe(false); // writes switched off since
    expect(scopeMatchesMode({ scopeMode: "off" }, "on")).toBe(false); // writes switched on since
  });

  it("counts a session with no record as read-only", () => {
    expect(scopeMatchesMode({}, "off")).toBe(true);
    expect(scopeMatchesMode(null, undefined)).toBe(true);
    expect(scopeMatchesMode({}, "on")).toBe(false);
  });
});
