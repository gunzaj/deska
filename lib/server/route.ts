// One wrapper for API route handlers (v5 4.1): the viewer check, JSON and query
// parsing, error shapes, cache headers and the CSRF Origin check live here, not
// in 30 copies.
import { NextRequest, NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { writeContext, type WriteContext } from "@/lib/outbox/http";
import { LOCAL_OWNER } from "@/lib/local-owner";
import { getViewerLogin } from "@/lib/session";
import { redactError } from "@/lib/sync/health";

/**
 * - `viewer`: a signed-in user; the handler gets `viewer` (their GitHub login,
 *   what `me` means in issue filters) and `owner`, the key of every local
 *   record (tasks, views' snoozes, watches, prefs, notifications).
 * - `write`: a signed-in user who may write to GitHub; the handler gets
 *   `viewer`, `token` and `store` (see `writeContext`).
 * - `public`: no local user needed (onboarding asks before there is one). In
 *   the desktop app the middleware has still checked the launch secret.
 */
export type RouteAuth = "viewer" | "write" | "public";

/** Throw from a handler to answer with this status and `{ error }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

type AuthCtx<A extends RouteAuth> = A extends "viewer" ? { viewer: string; owner: string } : A extends "write" ? WriteContext : Record<never, never>;

type RouteOptions<A extends RouteAuth, B extends ZodType | undefined, Q extends ZodType | undefined, P extends ZodType | undefined> = {
  auth: A;
  /** Parsed from the JSON body. A missing or malformed body fails validation. */
  body?: B;
  /** Parsed from the query string (every key as a string). */
  query?: Q;
  /** Parsed from the dynamic path segments. */
  params?: P;
  /** The `error` text of a 400 from body, query or params validation. */
  invalid?: string;
};

type Parsed<S> = S extends ZodType ? z.output<S> : undefined;

type RouteArgs<A extends RouteAuth, B, Q, P> = AuthCtx<A> & { req: NextRequest; body: Parsed<B>; query: Parsed<Q>; params: Parsed<P> };

type RouteContext = { params: Promise<unknown> };

/**
 * The exported handler. A route with `params` takes Next's context, typed from
 * the schema so Next's own route type check accepts it.
 */
type Handler<P> = P extends ZodType ? (req: Request, context: { params: Promise<z.input<P>> }) => Promise<Response> : (req: Request) => Promise<Response>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const json = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

function issuesOf(error: z.ZodError) {
  return error.issues.slice(0, 5).map((i) => ({ path: i.path.map(String), message: i.message }));
}

/** Hosts that may originate a browser request to this server. */
function allowedHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  for (const h of [req.headers.get("host"), req.headers.get("x-forwarded-host"), req.nextUrl.host]) if (h) hosts.add(h);
  return hosts;
}

/**
 * CSRF backstop on top of SameSite=Strict: a mutation from another origin is
 * refused. A request without an Origin header (curl, server-side callers) is
 * let through: browsers always send one on cross-origin mutations, and these
 * callers have no ambient cookies to ride.
 */
export function originAllowed(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return allowedHosts(req).has(new URL(origin).host);
  } catch {
    // "null" (a sandboxed frame, a cross-origin redirect) or garbage.
    return false;
  }
}

/**
 * Wrap a handler. It returns a `Response` (passed through) or any JSON value
 * (sent as 200). Responses get `cache-control: no-store` unless the handler set
 * its own. A thrown `HttpError` answers with its status; anything else is
 * logged through `redactError` and answered with a generic 500, so SQL text
 * and hostnames never reach the client.
 */
export function route<
  A extends RouteAuth,
  B extends ZodType | undefined = undefined,
  Q extends ZodType | undefined = undefined,
  P extends ZodType | undefined = undefined,
>(options: RouteOptions<A, B, Q, P>, handler: (args: RouteArgs<A, B, Q, P>) => Promise<unknown> | unknown) {
  const exported = async (req: Request, context?: RouteContext): Promise<Response> => {
    const res = await run(req instanceof NextRequest ? req : new NextRequest(req), context);
    try {
      if (!res.headers.has("cache-control")) res.headers.set("cache-control", "no-store");
    } catch {
      // Immutable headers (a response built elsewhere): leave them as they are.
    }
    return res;
  };
  return exported as unknown as Handler<P>;

  async function run(req: NextRequest, context: RouteContext | undefined): Promise<Response> {
    try {
      let auth: object;
      // Cheap checks before the viewer lookup is spent on a forged request.
      if (MUTATING.has(req.method) && !originAllowed(req)) return json("cross-origin request refused", 403);
      if (options.auth === "public") {
        auth = {};
      } else {
        if (options.auth === "write") {
          const ctx = await writeContext();
          if (ctx instanceof NextResponse) return ctx;
          auth = ctx;
        } else {
          const viewer = await getViewerLogin();
          if (!viewer) return json("unauthenticated", 401);
          auth = { viewer, owner: LOCAL_OWNER };
        }
      }

      const label = options.invalid ?? "invalid request";
      const parse = <S extends ZodType | undefined>(schema: S, value: unknown): { ok: true; value: Parsed<S> } | { ok: false; res: Response } => {
        if (!schema) return { ok: true, value: undefined as Parsed<S> };
        const r = schema.safeParse(value);
        return r.success ? { ok: true, value: r.data as Parsed<S> } : { ok: false, res: json(label, 400, { issues: issuesOf(r.error) }) };
      };

      const params = parse(options.params, options.params ? await context?.params : undefined);
      if (!params.ok) return params.res;
      const query = parse(options.query, options.query ? Object.fromEntries(req.nextUrl.searchParams) : undefined);
      if (!query.ok) return query.res;
      const body = parse(options.body, options.body ? await req.json().catch(() => null) : undefined);
      if (!body.ok) return body.res;

      const out = await handler({ ...auth, req, params: params.value, query: query.value, body: body.value } as RouteArgs<A, B, Q, P>);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof HttpError) return json(e.message, e.status, e.extra);
      console.error(`${req.method} ${req.nextUrl.pathname}: ${redactError(e)}`);
      return json("internal error", 500);
    }
  }
}

/** `[id]` path segment, bounded. Whether it names anything is the service's call. */
export const idParams = z.object({ id: z.string().min(1).max(200) });

/** A 503 for a store or database that can't be read; the detail goes to the log only. */
export function storeUnavailable(where: string, e: unknown): HttpError {
  console.error(`${where}: store unavailable: ${redactError(e)}`);
  return new HttpError(503, "store unavailable");
}
