// Where the `claude` CLI is: the login-shell PATH main resolved once per launch
// (SPEC §2.1), handed to the server as DESKA_LOGIN_PATH.
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

function isExecutableFile(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The PATH to look on: the login shell's (tests set DESKA_LOGIN_PATH themselves). */
export function loginPath(): string {
  return process.env.DESKA_LOGIN_PATH || process.env.PATH || "/usr/bin:/bin";
}

/** The first executable called `name` on `pathValue`. */
export function findOnPath(name: string, pathValue: string = loginPath()): string | null {
  for (const dir of new Set(pathValue.split(":").filter((d) => path.isAbsolute(d) && !d.includes("\0")))) {
    const file = path.join(dir, name);
    if (isExecutableFile(file)) return file;
  }
  return null;
}
