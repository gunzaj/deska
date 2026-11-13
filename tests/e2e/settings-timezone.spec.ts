import { expect, test } from "@playwright/test";
import { as, resetSharedSettings } from "./helpers";

// Shared server settings start and end at their defaults (issue #6).
test.beforeEach(({ request }) => resetSharedSettings(request));
test.afterEach(({ request }) => resetSharedSettings(request));

// Improvement 14: the time zone moved from the bell to app settings, keeps its
// value across a reload, and is no longer under the bell.
test("the time zone lives in Settings and survives a reload", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/settings");
  const zone = page.getByLabel("Time zone");
  await expect(zone).toBeVisible();
  const saved = page.waitForResponse((r) => r.url().includes("/api/me/prefs") && r.request().method() === "PATCH" && r.ok());
  await zone.selectOption("Europe/Prague");
  await saved;
  await page.reload();
  await expect(page.getByLabel("Time zone")).toHaveValue("Europe/Prague");

  await page.getByRole("button", { name: /Notifications/ }).click();
  const bell = page.getByRole("dialog").filter({ hasText: "Notifications" });
  await expect(bell).toBeVisible();
  await expect(bell.getByLabel("Time zone")).toHaveCount(0);
  await context.close();
});
