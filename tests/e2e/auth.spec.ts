import { expect, test } from "@playwright/test";

// Mocked-OAuth E2E: the server runs with E2E_AUTH_BYPASS=1 (see
// playwright.config.ts) so the x-e2e-login header stands in for a GitHub
// session. No real OAuth or GitHub calls are made.

test("unauthenticated visitor is sent to /signin", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBeLessThan(400);
  await expect(page).toHaveURL(/\/signin/);
});

test("allowlisted login reaches /", async ({ browser }) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-e2e-login": "alice" },
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible({ timeout: 20_000 });
  await context.close();
});

test("non-allowlisted login gets 403", async ({ browser }) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-e2e-login": "stranger" },
  });
  const page = await context.newPage();
  const res = await page.goto("/");
  expect(res?.status()).toBe(403);
  await expect(page.getByText(/Not allowed/i)).toBeVisible();
  await context.close();
});
