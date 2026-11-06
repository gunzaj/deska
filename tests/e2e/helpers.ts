// Shared e2e helpers for the write-back specs. The e2e servers run with
// writes off; these turn them on in the payload the browser gets and answer
// the edit route in the test, so nothing is ever sent to GitHub.
import type { Browser, Page, Route } from "@playwright/test";

export async function as(browser: Browser, login = "alice") {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-e2e-login": login } });
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
