// One place that reads and validates the GitHub target (repo, org,
// project) from the environment. There are deliberately no production defaults:
// a deployment that forgot a variable must fail loudly instead of reading, or
// worse writing to, the real widgets repo and project (v5 1.2/4.2).
import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const repoFull = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "must look like owner/repo");
const orgName = z.string().regex(/^[A-Za-z0-9_.-]+$/, "must be an organization login");
const projectNumber = z.coerce.number().int().positive();

export type GithubTarget = {
  /** `owner/repo`. */
  repoFull: string;
  owner: string;
  repo: string;
  org: string;
  /** The org Project's number (`GITHUB_PROJECT_NUMBER`). */
  projectNumber: number;
};

function read<T>(name: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const raw = process.env[name]?.trim();
  if (!raw) throw new ConfigError(`${name} is not set`);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`${name} is invalid: ${parsed.error.issues[0]?.message ?? "bad value"}`);
  return parsed.data;
}

/** `GITHUB_REPO`, validated. Throws `ConfigError` when unset. */
export function githubRepo(): { repoFull: string; owner: string; repo: string } {
  const full = read("GITHUB_REPO", repoFull);
  const [owner, repo] = full.split("/") as [string, string];
  return { repoFull: full, owner, repo };
}

/** `GITHUB_ORG`, validated. Throws `ConfigError` when unset. */
export function githubOrg(): string {
  return read("GITHUB_ORG", orgName);
}

/** Repo, org and project number together: what sync and writes need. */
export function githubTarget(): GithubTarget {
  return { ...githubRepo(), org: githubOrg(), projectNumber: read("GITHUB_PROJECT_NUMBER", projectNumber) };
}

/**
 * `GITHUB_PROJECT_ID` pins the project's node ID. Optional at first;
 * the write client compares it with the project it loads and refuses to write
 * on a mismatch. Required in practice once production writes are on.
 */
export function pinnedProjectId(): string | null {
  return process.env.GITHUB_PROJECT_ID?.trim() || null;
}

/** `WRITE_MODE=on`. Anything else means no GitHub writes. */
export function writeMode(): boolean {
  return process.env.WRITE_MODE === "on";
}

/**
 * The repo shown in links and rendered Markdown. Rendering only: this never
 * selects what sync reads or writes touch, so it may fall back to a label.
 */
export function displayRepo(): string {
  return process.env.GITHUB_REPO?.trim() || "acme/widgets";
}

const GITHUB_API = "https://api.github.com";

/**
 * Where GitHub API calls go: always https://api.github.com, except that
 * `DESKA_GITHUB_API_URL` may point at a loopback mock server
 * (`http://127.0.0.1:<port>`) for automated tests of the desktop app. Any other
 * value is ignored, so the token can never be sent off this machine to
 * anything but GitHub.
 */
export function githubApiBase(env: Record<string, string | undefined> = process.env): string {
  const v = env.DESKA_GITHUB_API_URL?.trim();
  return v && LOOPBACK_API.test(v) ? v : GITHUB_API;
}

/** The only accepted override: plain http on 127.0.0.1 with a port, nothing else. */
export const LOOPBACK_API = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;
