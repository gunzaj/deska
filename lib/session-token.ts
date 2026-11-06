// Edge-safe session JWT reader. The middleware cannot import lib/auth (it
// pulls in the database), so it decodes the Auth.js cookie directly.
import type { NextRequest } from "next/server";
import { getToken, type JWT } from "next-auth/jwt";

const SECURE_SESSION_COOKIE = "__Secure-authjs.session-token";

/**
 * The decoded session JWT, or null. On https Auth.js names the cookie with a
 * `__Secure-` prefix and salts the JWE with that name, but getToken() assumes
 * the unprefixed name unless told otherwise — so on an https deployment it
 * found no session and every request bounced back to /signin. Large sessions
 * are chunked (`….0`, `….1`), hence the prefix match.
 */
export function getSessionToken(req: NextRequest): Promise<JWT | null> {
  const secureCookie = req.cookies.getAll().some((c) => c.name.startsWith(SECURE_SESSION_COOKIE));
  return getToken({ req, secret: process.env.AUTH_SECRET, secureCookie });
}

/**
 * Where to send the user after an auth hop: `next` if it stays on this origin,
 * else "/". A prefix check alone is not enough — URL parsing turns
 * "/\evil.com" and "/<tab>/evil.com" into https://evil.com/.
 */
export function sameOriginUrl(next: string | null, base: string): URL {
  const home = new URL("/", base);
  if (!next?.startsWith("/")) return home;
  try {
    const url = new URL(next, base);
    return url.origin === home.origin ? url : home;
  } catch {
    return home;
  }
}
