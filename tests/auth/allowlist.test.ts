import { describe, expect, it } from "vitest";
import { isAllowedLogin, parseAllowlist } from "@/lib/allowlist";

describe("allowlist", () => {
  it("parses comma-separated logins", () => {
    expect(parseAllowlist("alice, Bob")).toEqual(["alice", "bob"]);
    expect(parseAllowlist("")).toEqual([]);
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(isAllowedLogin("Alice", "alice,bob")).toBe(true);
    expect(isAllowedLogin("stranger", "alice,bob")).toBe(false);
  });

  it("denies empty login and empty allowlist", () => {
    expect(isAllowedLogin(null, "alice")).toBe(false);
    expect(isAllowedLogin("alice", "")).toBe(false);
  });
});
