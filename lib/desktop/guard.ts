// Local server hardening for the desktop app (SPEC §2.2). Edge-safe: no
// imports, the middleware runs it on every request.
//
// The Electron main process starts the server on 127.0.0.1 and a random port,
// generates a 256-bit secret per launch and hands both to the server over IPC
// (desktop/server-entry.ts puts them in this process's environment). It sets
// the same secret as an HttpOnly, SameSite=Strict cookie on the window's
// session before the first load. Any request without that cookie, or for any
// Host but 127.0.0.1:<port>, is refused: another local process or a web page
// doing DNS rebinding cannot read or change anything.

/** The per-launch secret cookie the window sends with every request. */
export const LAUNCH_COOKIE = "deska_launch";

/** 256 bits as hex. Shorter secrets are refused (fail closed). */
const MIN_SECRET_LENGTH = 64;

export type DesktopGuard = {
  /** The per-launch secret; empty when main never sent one (everything is refused). */
  secret: string;
  /** The only Host accepted: `127.0.0.1:<port>`. */
  host: string;
};

export type GuardVerdict = "ok" | "bad-host" | "bad-secret" | "bad-origin";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Null outside the desktop app (`DESKA_DESKTOP=1`): dev, tests and e2e. */
export function desktopGuard(env: Record<string, string | undefined> = process.env): DesktopGuard | null {
  if (env.DESKA_DESKTOP !== "1") return null;
  return { secret: env.DESKA_LAUNCH_SECRET ?? "", host: env.DESKA_HOST ?? "" };
}

/** Compares without an early exit, so timing does not reveal a prefix. */
function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  return diff === 0;
}

export function checkDesktopRequest(
  guard: DesktopGuard,
  req: { host: string | null; cookie: string | undefined; method: string; origin: string | null },
): GuardVerdict {
  if (!guard.host || req.host !== guard.host) return "bad-host";
  if (guard.secret.length < MIN_SECRET_LENGTH || !req.cookie || !sameSecret(req.cookie, guard.secret)) return "bad-secret";
  // Mutations must come from the app's own pages. A request without an Origin
  // (the app's own server-side fetches) still had to carry the secret above.
  if (MUTATING.has(req.method.toUpperCase()) && req.origin !== null && req.origin !== `http://${guard.host}`) return "bad-origin";
  return "ok";
}
