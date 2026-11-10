// The login-shell PATH and the GitHub CLI (SPEC §2.1, §2.3, §3.1). Plain Node,
// no Electron: main calls these, tests run them against a fake `gh` script.
//
// Deska only ever *reads* from the GitHub CLI: `gh auth token` for the token
// and `gh auth status` for the account name. It never runs `gh auth login` or
// `gh auth refresh`. The token comes back on stdout and goes to the local
// server over IPC: never into a file, an argument or an environment.
import { execFile } from "node:child_process";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import path from "node:path";

type Env = Record<string, string | undefined>;

/** Where Homebrew puts `gh` and `claude`; a Mac app launched from the Dock has neither on its PATH. */
export const FALLBACK_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
const DEFAULT_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const MARK = "__DESKA_PATH__";
const LOGIN_SHELL_TIMEOUT_MS = 5_000;
const GH_TIMEOUT_MS = 10_000;

const absoluteDirs = (value: string) => [...new Set(value.split(":").filter((d) => path.isAbsolute(d) && !d.includes("\0")))];

/** The PATH used when the login shell can't be asked: Homebrew's folders plus the process's own (or the system default). */
export function fallbackPath(env: Env = process.env): string {
  return absoluteDirs([...FALLBACK_DIRS, env.PATH || DEFAULT_PATH].join(":")).join(":");
}

/** The PATH between the two markers of the login shell's output (its profile may print anything around them). */
export function parsePathOutput(stdout: string): string | null {
  const start = stdout.indexOf(MARK);
  const end = stdout.indexOf(MARK, start + MARK.length);
  if (start < 0 || end < 0) return null;
  const dirs = absoluteDirs(stdout.slice(start + MARK.length, end).trim());
  return dirs.length ? dirs.join(":") : null;
}

function isExecutableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** What a child process of main may inherit: nothing of Deska's own, and with `pathValue` as its PATH. */
export function childEnv(env: Env, pathValue?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || k.startsWith("DESKA_") || k === "ELECTRON_RUN_AS_NODE") continue;
    out[k] = v;
  }
  if (pathValue) out.PATH = pathValue;
  return out;
}

const TOKEN_VARS = new Set(["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"]);

/** The local server's environment: no Deska variable and no GitHub token a terminal may have exported. Secrets arrive over IPC. */
export function serverEnv(env: Env): Record<string, string> {
  const out = childEnv(env);
  for (const k of Object.keys(out)) if (TOKEN_VARS.has(k)) delete out[k];
  return out;
}

/**
 * The PATH of the user's login shell (`$SHELL -l -c`), resolved once per
 * launch: it is where `gh` and `claude` live. Falls back after 5 s, or when
 * the shell prints nothing usable.
 */
export function resolveLoginPath(env: Env = process.env, timeoutMs = LOGIN_SHELL_TIMEOUT_MS): Promise<string> {
  const shell = env.SHELL && path.isAbsolute(env.SHELL) && isExecutableFile(env.SHELL) ? env.SHELL : "/bin/zsh";
  return new Promise((resolve) => {
    const done = (value: string | null) => resolve(value ?? fallbackPath(env));
    try {
      const child = execFile(shell, ["-l", "-c", `printf '${MARK}%s${MARK}' "$PATH"`], { env: childEnv(env) as NodeJS.ProcessEnv, timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 }, (err, stdout) =>
        done(err ? null : parsePathOutput(String(stdout))),
      );
      child.stdin?.end();
    } catch {
      done(null);
    }
  });
}

/** The first executable called `name` on `pathValue`, as an absolute path. */
export function findOnPath(name: string, pathValue: string): string | null {
  for (const dir of absoluteDirs(pathValue)) {
    const file = path.join(dir, name);
    if (isExecutableFile(file)) return file;
  }
  return null;
}

/** What `gh auth token` may print: an OAuth token, or a PAT the user logged the CLI in with. */
const GH_TOKEN = /^(?:gh[pousr]_[A-Za-z0-9]{20,250}|github_pat_[A-Za-z0-9_]{20,250})$/;

export type GhRead = { state: "ok"; token: string } | { state: "not-found" } | { state: "logged-out" };

function run(file: string, args: string[], env: Record<string, string>, timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    try {
      const child = execFile(file, args, { env: env as NodeJS.ProcessEnv, timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout), stderr: String(stderr) }));
      child.stdin?.end();
    } catch {
      resolve({ ok: false, stdout: "", stderr: "" });
    }
  });
}

/**
 * `gh auth token --hostname github.com`. "not-found": no `gh` on the PATH;
 * "logged-out": it failed or printed no token. Nothing `gh` prints is kept or
 * logged except the token itself, which only goes back to the caller.
 */
export async function readGhToken(pathValue: string, env: Env = process.env, timeoutMs = GH_TIMEOUT_MS): Promise<GhRead> {
  const gh = findOnPath("gh", pathValue);
  if (!gh) return { state: "not-found" };
  const out = await run(gh, ["auth", "token", "--hostname", "github.com"], childEnv(env, pathValue), timeoutMs);
  const token = out.stdout.trim();
  return out.ok && GH_TOKEN.test(token) ? { state: "ok", token } : { state: "logged-out" };
}

/** The account `gh auth status` names for github.com, for "signed in as <login>". Null when it can't be read. */
export async function readGhLogin(pathValue: string, env: Env = process.env, timeoutMs = LOGIN_SHELL_TIMEOUT_MS): Promise<string | null> {
  const gh = findOnPath("gh", pathValue);
  if (!gh) return null;
  // Old versions print to stderr, and it exits non-zero when any other host has a problem.
  const out = await run(gh, ["auth", "status", "--hostname", "github.com"], childEnv(env, pathValue), timeoutMs);
  return /Logged in to github\.com (?:account|as) ([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/.exec(`${out.stdout}\n${out.stderr}`)?.[1] ?? null;
}
