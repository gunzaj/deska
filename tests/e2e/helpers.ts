// Shared e2e helpers for the write-back specs. The e2e servers run with
// writes off; these turn them on in the payload the browser gets and answer
// the edit route in the test, so nothing is ever sent to GitHub.
import type { APIRequestContext, Browser, BrowserContextOptions, Page, Route } from "@playwright/test";
import { DEFAULT_AI_SETTINGS } from "../../lib/ai/types";

/**
 * A browser context signed in as `login` (the test-only identity).
 *
 * Its `close()` first drops every route handler, ignoring the ones still
 * running (issue #6): a handler busy in `route.fetch` when the context closes
 * would otherwise reject after the test ended, and Playwright reports that
 * error against whichever test runs next.
 */
export async function as(browser: Browser, login = "alice", options: BrowserContextOptions = {}) {
  const context = await browser.newContext({ ...options, extraHTTPHeaders: { ...options.extraHTTPHeaders, "x-e2e-login": login } });
  const close = context.close.bind(context);
  context.close = async (opts) => {
    await Promise.all([context.unrouteAll({ behavior: "ignoreErrors" }), ...context.pages().map((p) => p.unrouteAll({ behavior: "ignoreErrors" }))]).catch(() => {});
    return close(opts);
  };
  return { context, page: await context.newPage() };
}

/** Writes on in /api/data, optionally with `extraIssues` synthetic open issues. */
export async function writesOn(page: Page, opts: { extraIssues?: number } = {}) {
  await page.route("**/api/data", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const res = await route.fetch({ headers });
    const json = await res.json();
    json.meta.writeMode = true;
    json.meta.closeBlocked = null;
    for (let n = 1; n <= (opts.extraIssues ?? 0); n++) {
      json.issues.push({ id: `I_syn${n}`, n: 1000 + n, t: `Synthetic issue ${n}`, o: 1, au: "alice", c: "2026-09-01T00:00:00Z", u: "2026-09-01T00:00:00Z" });
    }
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
}

export type Sent = { field: string; base?: unknown; next: unknown };

/** Answer edits with `reply(body, n)`; returns everything sent. */
export async function editRoute(page: Page, reply: (body: Sent, n: number) => { status: number; json: unknown } | Promise<{ status: number; json: unknown }>): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route("**/api/issues/*/edit", async (route: Route) => {
    const body = route.request().postDataJSON() as Sent;
    sent.push(body);
    const r = await reply(body, sent.length);
    await route.fulfill({ status: r.status, contentType: "application/json", json: r.json });
  });
  return sent;
}

export const done = (body: Sent) => ({ status: 200, json: { entry: { id: "e", status: "done", error: null, next: body.next } } });

/**
 * Put the server-wide settings the specs change back to their defaults: the
 * time zone and "My default" (prefs), AI settings and the theme. The e2e
 * servers are shared by every spec, so a spec that changes one of these runs
 * this before and after each test; a test that fails halfway then can't leave
 * its setting behind for the next spec (issue #6).
 */
export async function resetSharedSettings(request: APIRequestContext) {
  const headers = { "x-e2e-login": "alice" };
  const results = await Promise.all([
    request.patch("/api/me/prefs", { headers, data: { tz: null, defaultTeam: null } }),
    request.post("/api/ai/settings", { headers, data: DEFAULT_AI_SETTINGS }),
    request.post("/api/settings/theme", { headers, data: { theme: "system" } }),
  ]);
  for (const r of results) if (!r.ok()) throw new Error(`resetSharedSettings: ${r.url()} answered ${r.status()}`);
}
