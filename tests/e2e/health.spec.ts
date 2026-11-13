import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// S3: failed refreshes are visible, and a 401 (GitHub disconnected) stops the
// app behind a banner instead of showing old data forever.


test("a 401 from /api/data shows the disconnected banner", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.route("**/api/data", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthenticated" }) }));
  await page.goto("/backlog");
  await expect(page.getByText("GitHub is disconnected")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Connect GitHub" })).toHaveAttribute("href", "/onboarding");
  await context.close();
});

test("a 401 from /api/tasks blocks the loaded app with the banner", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.route("**/api/tasks", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthenticated" }) }));
  await page.goto("/backlog");
  // Issue data loads fine; the task store's 401 still blocks the app.
  await expect(page.getByText("Bug: crash on start")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("alertdialog", { name: "GitHub is disconnected" })).toBeVisible();
  await context.close();
});

test("/api/sync-status and POST /api/sync-now refuse an anonymous caller", async ({ request }) => {
  // The route-level viewer check (not only the middleware) answers 401.
  expect((await request.get("/api/sync-status")).status()).toBe(401);
  expect((await request.post("/api/sync-now")).status()).toBe(401);
});
