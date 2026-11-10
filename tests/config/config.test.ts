import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAllowsWrites, ConfigError, githubOrg, githubRepo, githubTarget } from "@/lib/config";
import { GitHubWriteClient } from "@/lib/github/write-client";
import { EMPTY_FIELD_MAP } from "@/lib/sync/field-map";

const KEYS = ["GITHUB_REPO", "GITHUB_ORG", "GITHUB_PROJECT_NUMBER", "GITHUB_PROJECT_ID", "DESKA_WRITES"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("config (v5 4.2)", () => {
  it("parses the GitHub target", () => {
    process.env.GITHUB_REPO = "acme/widgets";
    process.env.GITHUB_ORG = "acme";
    process.env.GITHUB_PROJECT_NUMBER = "7";
    expect(githubTarget()).toEqual({ repoFull: "acme/widgets", owner: "acme", repo: "widgets", org: "acme", projectNumber: 7 });
  });

  it("has no production defaults", () => {
    delete process.env.GITHUB_REPO;
    delete process.env.GITHUB_ORG;
    delete process.env.GITHUB_PROJECT_NUMBER;
    expect(() => githubRepo()).toThrow(ConfigError);
    expect(() => githubOrg()).toThrow(/GITHUB_ORG is not set/);
    expect(() => githubTarget()).toThrow(ConfigError);
  });

  it.each([
    ["GITHUB_REPO", "not-a-repo"],
    ["GITHUB_ORG", "has space"],
    ["GITHUB_PROJECT_NUMBER", "0"],
    ["GITHUB_PROJECT_NUMBER", "abc"],
  ])("rejects a malformed %s=%s", (key, value) => {
    process.env.GITHUB_REPO = "acme/widgets";
    process.env.GITHUB_ORG = "acme";
    process.env.GITHUB_PROJECT_NUMBER = "7";
    process.env[key] = value;
    expect(() => githubTarget()).toThrow(ConfigError);
  });
});

describe("write client target (v5 1.2)", () => {
  it.each(["GITHUB_REPO", "GITHUB_ORG", "GITHUB_PROJECT_NUMBER"] as const)("throws at construction when %s is unset", (key) => {
    process.env.WRITE_MODE = "on";
    process.env.GITHUB_REPO = "acme/widgets";
    process.env.GITHUB_ORG = "acme";
    process.env.GITHUB_PROJECT_NUMBER = "7";
    delete process.env[key];
    expect(() => new GitHubWriteClient("tok", EMPTY_FIELD_MAP)).toThrow(new RegExp(`${key} is not set`));
  });
});

describe("GitHub API base (D3)", () => {
  it("is api.github.com unless a loopback mock is named; anything else is ignored", async () => {
    const { githubApiBase } = await import("@/lib/config");
    expect(githubApiBase({})).toBe("https://api.github.com");
    expect(githubApiBase({ DESKA_GITHUB_API_URL: "http://127.0.0.1:43210" })).toBe("http://127.0.0.1:43210");
    for (const v of ["https://evil.example", "http://localhost:43210", "http://127.0.0.1:43210/path", "http://127.0.0.1.evil.example:80", "http://10.0.0.1:80"]) {
      expect(githubApiBase({ DESKA_GITHUB_API_URL: v }), v).toBe("https://api.github.com");
    }
  });
});

describe("build write switch (SPEC §3.4)", () => {
  it("only a build stamped DESKA_WRITES=on allows writes (SPEC §3.4 part 3)", () => {
    delete process.env.DESKA_WRITES;
    expect(buildAllowsWrites()).toBe(false);
    process.env.DESKA_WRITES = "off";
    expect(buildAllowsWrites()).toBe(false);
    process.env.DESKA_WRITES = "on";
    expect(buildAllowsWrites()).toBe(true);
    // The write client refuses to exist without the full gate, whatever the env says.
    expect(() => new GitHubWriteClient("github_pat_test", EMPTY_FIELD_MAP, { repoFull: "acme/widgets", owner: "acme", repo: "widgets", org: "acme", projectNumber: 7 })).toThrow(/write gate/);
  });
});
