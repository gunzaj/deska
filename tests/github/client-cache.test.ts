// S7: Octokit clients are cached by sha256(token), at most 50.
import { describe, expect, it } from "vitest";
import { __clientCacheKeys, gqlClient, restClient } from "@/lib/github/client";

describe("GitHub client cache", () => {
  it("never keys a client by the plaintext token", () => {
    const token = "ghp_plaintextTokenThatMustNotBeAKey0123456789";
    expect(restClient(token)).toBe(restClient(token));
    expect(gqlClient(token)).toBe(gqlClient(token));
    const { rest, gql } = __clientCacheKeys();
    for (const k of [...rest, ...gql]) {
      expect(k).not.toContain(token);
      expect(k).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("keeps the 50 most recently used clients", () => {
    const first = restClient("token-0");
    for (let i = 1; i <= 60; i++) restClient(`token-${i}`);
    expect(__clientCacheKeys().rest.length).toBe(50);
    expect(restClient("token-0")).not.toBe(first);
    // A recently used one survives.
    const recent = restClient("token-60");
    for (let i = 100; i < 140; i++) restClient(`token-${i}`);
    expect(restClient("token-60")).toBe(recent);
  });
});
