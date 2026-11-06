import { describe, expect, it } from "vitest";
import { canonicalIssueUrl, fallbackIssueUrl, githubTarget, parseGitHubItemUrl } from "@/lib/github/url";

describe("GitHub item URLs", () => {
  it("parses issue and pull links, including a trailing slash", () => {
    expect(parseGitHubItemUrl("https://github.com/acme/widgets/issues/15020")).toEqual({
      owner: "acme",
      repo: "widgets",
      number: 15020,
      kind: "issues",
    });
    expect(parseGitHubItemUrl("https://github.com/acme/widgets/pull/4/")).toEqual({
      owner: "acme",
      repo: "widgets",
      number: 4,
      kind: "pull",
    });
    expect(parseGitHubItemUrl("https://example.com/acme/widgets/issues/1")).toBeNull();
  });

  it("keeps a stored link that points at a different repository", () => {
    const stored = "https://github.com/other/repo/issues/9";
    expect(canonicalIssueUrl(stored, "acme/widgets", 9)).toBe(stored);
    expect(canonicalIssueUrl(stored, "acme/widgets", 100)).toBe(stored);
    expect(canonicalIssueUrl(null, "acme/widgets", 100)).toBe(fallbackIssueUrl("acme/widgets", 100));
  });

  it("fetches the repository named in the cached link", () => {
    expect(githubTarget("https://github.com/other/repo/pull/9", 100, "acme/widgets")).toEqual({ repo: "other/repo", number: 9 });
    expect(githubTarget("", 100, "acme/widgets")).toEqual({ repo: "acme/widgets", number: 100 });
  });
});
