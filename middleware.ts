import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decideAccess, isAllowedLogin } from "./lib/allowlist";
import { contentSecurityPolicy } from "./lib/csp";
import { e2eBypassActive, e2eDefaultLogin } from "./lib/e2e-bypass";
import { scopeMatchesMode } from "./lib/github/scopes";
import { getSessionToken } from "./lib/session-token";

// /api/health is for uptime monitors: no session, and nothing in the body
// beyond the sync status.
const PUBLIC_PREFIXES = ["/signin", "/forbidden", "/api/auth", "/api/health"];

/**
 * Unauthenticated API calls get a 401, not a redirect to the sign-in page:
 * fetch follows redirects, so the client used to receive the sign-in HTML as
 * a 200 and could never tell that the session had expired (S3).
 */
function unauthenticated(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.redirect(new URL("/signin", req.url));
}

/**
 * An allowlist or org denial. A page gets the /forbidden page; an API call
 * gets JSON, since `fetch` callers parsed the HTML of that page as the answer
 * (v5 2.9).
 */
function forbidden(req: NextRequest, headers?: Headers) {
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.rewrite(new URL("/forbidden", req.url), { status: 403, ...(headers ? { request: { headers } } : {}) });
}

function isPublic(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(req: NextRequest) {
  // API calls answer JSON: no page, no CSP. Pages get a nonce that Next.js
  // reads back from the request's CSP header and stamps on its own scripts.
  if (req.nextUrl.pathname.startsWith("/api/")) return decide(req);
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  const res = await decide(req, headers);
  res.headers.set("content-security-policy", csp);
  return res;
}

async function decide(req: NextRequest, headers?: Headers) {
  const { pathname } = req.nextUrl;
  const pass = () => NextResponse.next(headers ? { request: { headers } } : undefined);
  if (isPublic(pathname)) return pass();

  // Vercel Cron calls GET /api/sync-now and /api/reconcile with a bearer
  // secret, not a session.
  if ((pathname === "/api/sync-now" || pathname === "/api/reconcile") && req.method === "GET") {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization");
    if (secret && auth === `Bearer ${secret}`) return pass();
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Test-only bypass for mocked-OAuth E2E (never active in production).
  if (e2eBypassActive()) {
    const fakeLogin = req.headers.get("x-e2e-login") ?? e2eDefaultLogin();
    if (!fakeLogin) return unauthenticated(req);
    if (!isAllowedLogin(fakeLogin)) return forbidden(req, headers);
    return pass();
  }

  const t = (await getSessionToken(req)) as { login?: string; orgActive?: boolean; orgCheckedAt?: number; scopeMode?: string } | null;
  const login = t?.login;
  if (!login) return unauthenticated(req);
  // Issued under the other WRITE_MODE (writes were switched on or off since
  // this person signed in): sign in again for the right scopes (v5 2.8).
  if (!scopeMatchesMode(t, process.env.WRITE_MODE)) return unauthenticated(req);
  const decision = decideAccess({ login, orgActive: t?.orgActive, orgCheckedAt: t?.orgCheckedAt });
  if (decision === "recheck") {
    // Org membership is due for a check (SPEC §14): the recheck route refreshes
    // the session and sends the request on (307 keeps method and body).
    if (pathname === "/api/access/recheck") return pass();
    const url = new URL("/api/access/recheck", req.url);
    url.searchParams.set("next", `${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(url, 307);
  }
  if (decision === "deny") return forbidden(req, headers);
  return pass();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
