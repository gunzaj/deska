import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, githubOrg, githubRepo, githubTarget } from "@/lib/config";
import { GitHubWriteClient } from "@/lib/github/write-client";
import { EMPTY_FIELD_MAP } from "@/lib/sync/field-map";

const KEYS = ["GITHUB_REPO", "GITHUB_ORG", "GITHUB_PROJECT_NUMBER", "GITHUB_PROJECT_ID", "WRITE_MODE"] as const;
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
