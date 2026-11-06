import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// F7: Possible duplicates in the issue panel.

test("the panel lists possible duplicates as links that open that issue", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.route("**/api/issues/102/duplicates", (route) =>
    route.fulfill({
      json: {
        duplicates: [
          { number: 101, title: "Sub: dashboard widget", state: "open", url: "https://github.com/x/y/issues/101", similarity: 0.82 },
          { number: 100, title: "Epic: dashboard overhaul", state: "closed", url: "https://github.com/x/y/issues/100", similarity: 0.45 },
        ],
      },
    }),
  );
  await page.goto("/backlog?issue=102");
  const section = page.getByRole("region", { name: "Possible duplicates" });
  await expect(section).toBeVisible();
  await expect(section.getByRole("listitem")).toHaveCount(2);
  await expect(section).toContainText("82% alike");
  await expect(section).toContainText("closed · 45% alike");
  await section.getByRole("button", { name: /Sub: dashboard widget/ }).click();
  await expect(page.getByRole("complementary", { name: "Issue #101" })).toBeVisible();
  await context.close();
});

test("no section when nothing looks alike (the fixture titles are unrelated)", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog?issue=102");
  await expect(page.getByRole("complementary", { name: "Issue #102" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Description" })).toBeVisible();
  await expect(page.locator("[data-duplicates]")).toHaveCount(0);
  await context.close();
});

test("the duplicates API: session required, bad and unknown numbers refused", async ({ browser, request }) => {
  expect((await request.get("/api/issues/102/duplicates")).status()).toBe(401);
  const { context, page } = await as(browser);
  expect((await page.request.get("/api/issues/abc/duplicates")).status()).toBe(400);
  expect((await page.request.get("/api/issues/999999/duplicates")).status()).toBe(404);
  const ok = await page.request.get("/api/issues/102/duplicates");
  expect(ok.status()).toBe(200);
  expect((await ok.json()).duplicates).toEqual([]);
  await context.close();
});
