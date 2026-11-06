import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { contentSecurityPolicy } from "./lib/csp";
import { checkDesktopRequest, desktopGuard, LAUNCH_COOKIE } from "./lib/desktop/guard";

/**
 * Two jobs. In the desktop app (SPEC §2.2) every request, static files
 * included, needs the per-launch secret cookie and the exact 127.0.0.1:<port>
 * Host; the answer says nothing about which check failed. And every page gets
 * a strict CSP with a fresh nonce.
 *
 * There is no sign-in: the app has one local user, the owner of the stored
 * GitHub token (lib/session.ts). Pages without one go to onboarding, API
 * routes answer 401 (lib/server/route.ts).
 */
export async function middleware(req: NextRequest) {
  const guard = desktopGuard();
  if (guard) {
    const verdict = checkDesktopRequest(guard, {
      host: req.headers.get("host"),
      cookie: req.cookies.get(LAUNCH_COOKIE)?.value,
      method: req.method,
      origin: req.headers.get("origin"),
    });
    if (verdict !== "ok") return new NextResponse("Forbidden", { status: 403, headers: { "content-type": "text/plain" } });
  }
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/_next/static/") || pathname.startsWith("/_next/image")) return NextResponse.next();
  // API calls answer JSON: no page, no CSP. Pages get a nonce that Next.js
  // reads back from the request's CSP header and stamps on its own scripts.
  if (pathname.startsWith("/api/")) return NextResponse.next();
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production", guard !== null);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);
  return res;
}

// Every path: the desktop guard covers static files too (SPEC §2.2).
export const config = {
  matcher: ["/:path*"],
};
