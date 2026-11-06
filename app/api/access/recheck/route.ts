import { NextResponse, type NextRequest } from "next/server";
import { unstable_update } from "@/lib/auth";
import { sameOriginUrl } from "@/lib/session-token";

export const dynamic = "force-dynamic";

/**
 * Org membership recheck (SPEC §14). The middleware sends a request here when
 * the last check is older than ACCESS_RECHECK_HOURS. Updating the session runs
 * the jwt callback, which asks GitHub again; then the request continues. A
 * user who has left the org, or whom GitHub can't vouch for, gets /forbidden
 * (never a redirect loop).
 *
 * GET is deliberate, not an alias for a mutation: the middleware redirects with
 * 307, which preserves the method, and a page navigation arrives as GET. The only
 * "write" is refreshing the viewer's own session, and `next` is sanitised to a
 * same-origin path, so a cross-site request cannot do anything but re-check the
 * caller's own membership (IMPROVEMENTS-2 F3, decided: not a bug).
 */
async function recheck(req: NextRequest) {
  // Returns the session built from the refreshed token.
  const session = (await unstable_update({})) as { login?: string | null; access?: string } | null;
  if (!session?.login) return NextResponse.redirect(new URL("/signin", req.url));
  if (session.access !== "allow") return NextResponse.redirect(new URL("/forbidden", req.url));
  return NextResponse.redirect(sameOriginUrl(req.nextUrl.searchParams.get("next"), req.url), 307);
}

export const GET = recheck;
export const POST = recheck;
export const PATCH = recheck;
export const DELETE = recheck;
