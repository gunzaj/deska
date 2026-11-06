// Shared Octokit clients with throttling (SPEC §7: honor retry-after,
// x-ratelimit-reset; writes run serially per user in M6).
import { createHash } from "node:crypto";
import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { graphql } from "@octokit/graphql";

const Throttled = Octokit.plugin(throttling);

/**
 * Longest a single GitHub request may take. Octokit has no timeout of its own,
 * and the outbox lease (120 s) must outlive every call in a write (v5 1.5). A
 * timeout surfaces as a status-500 error, which the outbox retries.
 */
export function requestTimeoutMs(): number {
  const ms = Number(process.env.GITHUB_REQUEST_TIMEOUT_MS);
  return Number.isFinite(ms) && ms > 0 ? ms : 30_000;
}

/** `fetch` with a fresh deadline per request (one signal on a cached client would expire for good). */
const timedFetch: typeof fetch = (input, init) => {
  const deadline = AbortSignal.timeout(requestTimeoutMs());
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  return fetch(input, { ...init, signal });
};

/** Longest rate-limit wait we sit through in-process; beyond it we fail fast. */
const MAX_INLINE_WAIT_S = 60;

/**
 * Both throttling handlers used to return true unconditionally: the plugin
 * then retried forever, and a primary limit parked the request until the
 * hourly reset (far past a serverless timeout) instead of surfacing as "rate
 * limited until HH:MM". Retry once, and only for a short wait; otherwise the
 * 403/429 reaches the caller, which records the limit.
 */
export function retryOnLimit(kind: string) {
  return (retryAfter: number, options: { method: string; url: string }, _octokit: unknown, retryCount: number): boolean => {
    const retry = retryCount < 1 && retryAfter <= MAX_INLINE_WAIT_S;
    console.warn(`${kind} ${options.method} ${options.url}: ${retry ? `retrying after ${retryAfter}s` : "giving up"}`);
    return retry;
  };
}

type RestClient = ReturnType<typeof buildRestClient>;
function buildRestClient(token: string) {
  return new Throttled({
    auth: token,
    request: { fetch: timedFetch },
    throttle: {
      onRateLimit: retryOnLimit("rate limited"),
      onSecondaryRateLimit: retryOnLimit("secondary rate limit"),
    },
  });
}

type GqlClient = ReturnType<typeof buildGqlClient>;
function buildGqlClient(token: string) {
  return graphql.defaults({ headers: { authorization: `bearer ${token}` }, request: { fetch: timedFetch } }) as (
    q: string,
    p?: Record<string, unknown>,
  ) => Promise<any>;
}

// The throttling plugin keeps rate-limit state on the instance, so building a
// fresh client per call (as this module used to) threw that state away and made
// every request look like a first request. One client per token, cached.
//
// Keyed by sha256(token), never the plaintext token, and capped at the 50 most
// recently used (S7): with org access every signed-in user's token used to
// stay in these maps for the process lifetime.
const MAX_CLIENTS = 50;
const restCache = new Map<string, RestClient>();
const gqlCache = new Map<string, GqlClient>();

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Least-recently-used get-or-create: a hit moves to the end, the oldest goes. */
function cached<T>(cache: Map<string, T>, token: string, build: () => T): T {
  const key = tokenKey(token);
  let c = cache.get(key);
  if (c) cache.delete(key);
  else c = build();
  cache.set(key, c);
  while (cache.size > MAX_CLIENTS) cache.delete(cache.keys().next().value!);
  return c;
}

export function restClient(token: string): RestClient {
  return cached(restCache, token, () => buildRestClient(token));
}

export function gqlClient(token: string): GqlClient {
  return cached(gqlCache, token, () => buildGqlClient(token));
}

/** Tests only: the cache keys, to check no token is stored in the clear. */
export function __clientCacheKeys(): { rest: string[]; gql: string[] } {
  return { rest: [...restCache.keys()], gql: [...gqlCache.keys()] };
}
