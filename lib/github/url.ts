/**
 * The URL GitHub reported for an issue or pull request.
 * The browser used to rebuild `https://github.com/${GITHUB_REPO}/issues/${number}`,
 * so a stored link in another repository opened a different item that happened
 * to share the number.
 */

const GITHUB_ITEM = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/(issues|pull)\/(\d+)/i;

export type GitHubItemRef = {
  owner: string;
  repo: string;
  number: number;
  kind: "issues" | "pull";
};

export function parseGitHubItemUrl(url: string): GitHubItemRef | null {
  const m = GITHUB_ITEM.exec(url.trim());
  if (!m) return null;
  const number = Number(m[4]);
  if (!Number.isInteger(number) || number <= 0) return null;
  return { owner: m[1]!, repo: m[2]!, number, kind: m[3]!.toLowerCase() === "pull" ? "pull" : "issues" };
}

export function fallbackIssueUrl(repoFull: string, number: number): string {
  return `https://github.com/${repoFull}/issues/${number}`;
}

/** Prefer the link GitHub stored. Rebuild only when that link is missing or not a GitHub item. */
export function canonicalIssueUrl(stored: string | null | undefined, repoFull: string, number: number): string {
  const parsed = stored ? parseGitHubItemUrl(stored) : null;
  if (!parsed) return fallbackIssueUrl(repoFull, number);
  return `https://github.com/${parsed.owner}/${parsed.repo}/${parsed.kind}/${parsed.number}`;
}

/** Owner/repo and number to ask GitHub for, taken from the cached link when it parses. */
export function githubTarget(
  url: string | null | undefined,
  fallbackNumber: number,
  fallbackRepo: string,
): { repo: string; number: number } {
  const parsed = url ? parseGitHubItemUrl(url) : null;
  if (!parsed) return { repo: fallbackRepo, number: fallbackNumber };
  return { repo: `${parsed.owner}/${parsed.repo}`, number: parsed.number };
}
