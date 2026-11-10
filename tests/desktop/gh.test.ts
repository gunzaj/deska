// SPEC D15, §2.1, §2.3: the login-shell PATH and the GitHub CLI as a token
// source. Everything runs against fake `gh` and shell scripts in a temp
// folder: the real GitHub CLI is never called.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DESKTOP_PREFS } from "../../desktop/bridge";
import { childEnv, fallbackPath, findOnPath, parsePathOutput, readGhLogin, readGhToken, resolveLoginPath, serverEnv } from "../../desktop/gh";
import { parseDesktopPrefs, parsePrefsPatch } from "../../desktop/prefs";

// Obviously fake, and assembled so no token-shaped literal is committed.
const TOKEN = ["gho", `TESTFAKE${"0".repeat(28)}`].join("_");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "deska-gh-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function script(name: string, body: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** A fake `gh` that records its arguments and environment, then runs `body`. */
function fakeGh(body: string) {
  script("gh", `printf '%s\\n' "$*" >> "${dir}/args.log"\nenv > "${dir}/env.log"\n${body}`);
}

const PATH_WITH = () => `${dir}:/usr/bin:/bin`;

describe("login-shell PATH (§2.1)", () => {
  it("reads the PATH between the markers, whatever the profile prints around them", () => {
    expect(parsePathOutput("Welcome back!\n__DESKA_PATH__/opt/homebrew/bin:/usr/bin:/bin__DESKA_PATH__\n")).toBe("/opt/homebrew/bin:/usr/bin:/bin");
    // Relative entries and repeats are dropped.
    expect(parsePathOutput("__DESKA_PATH__/a:.:bin:/a:/b__DESKA_PATH__")).toBe("/a:/b");
    expect(parsePathOutput("no markers")).toBeNull();
    expect(parsePathOutput("__DESKA_PATH____DESKA_PATH__")).toBeNull();
  });

  it("falls back to Homebrew's folders plus the process PATH", () => {
    expect(fallbackPath({ PATH: "/usr/bin:/bin" })).toBe("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    expect(fallbackPath({})).toBe("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("asks $SHELL -l -c once and takes its PATH", async () => {
    const shell = script("fakeshell", `printf '%s\\n' "$1 $2" > "${dir}/shell-args.log"\necho "motd noise"\nPATH=/from/login/shell:/usr/bin\neval "$3"`);
    expect(await resolveLoginPath({ SHELL: shell, PATH: "/usr/bin:/bin" })).toBe("/from/login/shell:/usr/bin");
    expect(readFileSync(path.join(dir, "shell-args.log"), "utf8").trim()).toBe("-l -c");
  });

  it("falls back when the shell hangs past the timeout, fails, or prints nothing usable", async () => {
    const env = { PATH: "/usr/bin:/bin" };
    const fallback = fallbackPath(env);
    expect(await resolveLoginPath({ ...env, SHELL: script("hang", "sleep 30") }, 200)).toBe(fallback);
    expect(await resolveLoginPath({ ...env, SHELL: script("fail", "exit 3") })).toBe(fallback);
    expect(await resolveLoginPath({ ...env, SHELL: script("quiet", "exit 0") })).toBe(fallback);
  });
});

describe("GitHub CLI token (§2.3, §3.1)", () => {
  it("finds an executable on the PATH, and only an executable", () => {
    fakeGh("exit 0");
    writeFileSync(path.join(dir, "notes"), "not a program");
    expect(findOnPath("gh", PATH_WITH())).toBe(path.join(dir, "gh"));
    expect(findOnPath("notes", PATH_WITH())).toBeNull();
    expect(findOnPath("gh", "/usr/bin:/bin:relative")).toBeNull();
  });

  it("a logged-in gh gives its token, asked for github.com only", async () => {
    fakeGh(`echo "${TOKEN}"`);
    expect(await readGhToken(PATH_WITH(), { HOME: dir })).toEqual({ state: "ok", token: TOKEN });
    expect(readFileSync(path.join(dir, "args.log"), "utf8").trim()).toBe("auth token --hostname github.com");
  });

  it("no gh on the PATH: not found, and nothing is run", async () => {
    expect(await readGhToken("/usr/bin:/bin", {})).toEqual({ state: "not-found" });
    expect(existsSync(path.join(dir, "args.log"))).toBe(false);
  });

  it("gh failing, printing nothing, or printing something that is no token: logged out", async () => {
    fakeGh(`echo "no oauth token found for github.com" >&2\nexit 1`);
    expect(await readGhToken(PATH_WITH(), {})).toEqual({ state: "logged-out" });
    fakeGh("exit 0");
    expect(await readGhToken(PATH_WITH(), {})).toEqual({ state: "logged-out" });
    fakeGh(`echo "To get started with GitHub CLI, please run: gh auth login"`);
    expect(await readGhToken(PATH_WITH(), {})).toEqual({ state: "logged-out" });
    fakeGh("sleep 30");
    expect(await readGhToken(PATH_WITH(), {}, 200)).toEqual({ state: "logged-out" });
  });

  it("gh gets no Deska variable in its environment", async () => {
    fakeGh(`echo "${TOKEN}"`);
    await readGhToken(PATH_WITH(), { HOME: dir, DESKA_USER_DATA_DIR: "/x", DESKA_LAUNCH_SECRET: "s3cret-value", ELECTRON_RUN_AS_NODE: "1" });
    const env = readFileSync(path.join(dir, "env.log"), "utf8");
    expect(env).not.toMatch(/DESKA_|ELECTRON_RUN_AS_NODE|s3cret-value/);
    expect(env).toContain(`PATH=${PATH_WITH()}`);
  });

  it("reads the account from gh auth status, in the new and the old wording", async () => {
    fakeGh(`echo "github.com"\necho "  ✓ Logged in to github.com account alice (keyring)"\necho "  - Token: gho_************"`);
    expect(await readGhLogin(PATH_WITH(), {})).toBe("alice");
    expect(readFileSync(path.join(dir, "args.log"), "utf8").trim()).toBe("auth status --hostname github.com");
    // Older versions: stderr, "as", and a non-zero exit when another host has a problem.
    fakeGh(`echo "  ✓ Logged in to github.com as bob (oauth_token)" >&2\nexit 1`);
    expect(await readGhLogin(PATH_WITH(), {})).toBe("bob");
    fakeGh(`echo "You are not logged into any GitHub hosts." >&2\nexit 1`);
    expect(await readGhLogin(PATH_WITH(), {})).toBeNull();
    expect(await readGhLogin("/usr/bin:/bin", {})).toBeNull();
  });
});

describe("child environments (D15: the token is in no child's environment)", () => {
  it("the local server gets no Deska variable and no GitHub token a terminal exported", () => {
    const env = serverEnv({ PATH: "/usr/bin", HOME: "/h", GH_TOKEN: TOKEN, GITHUB_TOKEN: TOKEN, GH_ENTERPRISE_TOKEN: TOKEN, GITHUB_ENTERPRISE_TOKEN: TOKEN, DESKA_TEST_PATH: "/t", ELECTRON_RUN_AS_NODE: "1", UNSET: undefined });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/h" });
    expect(JSON.stringify(env)).not.toContain(TOKEN);
  });

  it("a child of main gets the given PATH and nothing of Deska's", () => {
    expect(childEnv({ PATH: "/usr/bin", DESKA_X: "1", LANG: "C" }, "/a:/b")).toEqual({ PATH: "/a:/b", LANG: "C" });
  });
});

describe("the sign-in source in desktop-prefs.json (§2.3)", () => {
  it("defaults to a stored token; only \"gh\" switches it", () => {
    expect(DEFAULT_DESKTOP_PREFS.githubAuthSource).toBe("token");
    expect(parseDesktopPrefs({ githubAuthSource: "gh" }).githubAuthSource).toBe("gh");
    for (const junk of ["oauth", "", 1, null, { source: "gh" }]) expect(parseDesktopPrefs({ githubAuthSource: junk }).githubAuthSource).toBe("token");
  });

  it("the page cannot set it through desktop.set", () => {
    expect(parsePrefsPatch({ githubAuthSource: "gh", dockBadge: false })).toEqual({ patch: { dockBadge: false }, error: null });
  });
});
