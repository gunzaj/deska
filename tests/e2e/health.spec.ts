import { expect, test, type Browser } from "@playwright/test";

// S3: failed refreshes are visible, and a 401 stops the app behind a
// "Session expired" banner instead of showing old data forever.

async function as(browser: Browser, login = "alice") {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-e2e-login": login } });
  return { context, page: await context.newPage() };
}

test("a failed PR load shows the error and Retry; Retry loads the list", async ({ browser }) => {
  const { context, page } = await as(browser);
  // Fail every load until Retry: React's dev mode runs the first load twice.
  let fail = true;
  await page.route("**/api/prs", async (route) => {
    if (fail) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
    return route.fallback();
  });
  await page.goto("/pulls");
  await expect(page.getByText("Couldn't load pull requests")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Loading…")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("option").filter({ hasText: "Fix crash" })).toBeVisible();
  await expect(page.getByText("Couldn't load pull requests")).toHaveCount(0);
  await context.close();
});

test("a 401 from /api/data shows the session-expired banner", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.route("**/api/data", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthenticated" }) }));
  await page.goto("/backlog");
  await expect(page.getByText("Session expired")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin");
  await context.close();
});

test("a 401 from /api/tasks blocks the loaded app with the banner", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.route("**/api/tasks", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthenticated" }) }));
  await page.goto("/backlog");
  // Issue data loads fine; the task store's 401 still blocks the app.
  await expect(page.getByText("Bug: crash on start")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("alertdialog", { name: "Session expired, sign in again" })).toBeVisible();
  await context.close();
});

test("/api/health needs no session and carries only the status", async ({ request }) => {
  const res = await request.get("/api/health");
  // The e2e server runs on fixtures with no sync: unhealthy, but reachable.
  expect([200, 503]).toContain(res.status());
  expect(Object.keys(await res.json()).sort()).toEqual(["lastSyncAgeSec", "ok"]);
});

test("/api/sync-status and POST /api/sync-now refuse an anonymous caller", async ({ request }) => {
  // The route-level viewer check (not only the middleware) answers 401.
  expect((await request.get("/api/sync-status")).status()).toBe(401);
  expect((await request.post("/api/sync-now")).status()).toBe(401);
});
