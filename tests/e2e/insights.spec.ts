import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// F4: scoped Insights. Fixture Release Sprint 23 (e0000023) is current.

test("the scope picker narrows the numbers, and the URL keeps the scope", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/insights");
  const openTile = page.getByRole("link", { name: /^Open issues/ });
  await expect(openTile).toBeVisible();
  const all = Number((await openTile.innerText()).match(/\d[\d,]*/)![0].replace(/,/g, ""));

  await page.getByLabel("Scope").selectOption("release:e0000023");
  await expect(page).toHaveURL(/scope=release(%3A|:)e0000023/);
  const data = await (await page.request.get("/api/data")).json();
  const inRelease = data.issues.filter((i: { o: number; rl?: string }) => i.o === 1 && i.rl === "e0000023").length;
  await expect(page.getByRole("link", { name: /^Open issues/ })).toContainText(String(inRelease));
  expect(inRelease).toBeLessThan(all);

  // The tile links to the explorer with the scope's filter, so it opens what it counts.
  await page.getByRole("link", { name: /^Open issues/ }).click();
  await expect(page).toHaveURL(/\/issues\?s=/);
  await page.goBack();
  await expect(page.getByLabel("Scope")).toHaveValue("release:e0000023");

  await page.reload();
  await expect(page.getByLabel("Scope")).toHaveValue("release:e0000023");
  await context.close();
});

test("Insights has no pull request tile (D6)", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/insights");
  await expect(page.getByLabel("Scope")).toBeVisible();
  await expect(page.locator("[data-review-wait]")).toHaveCount(0);
  expect(await page.locator("main").innerText()).not.toMatch(/pull request|\bPRs?\b/i);
  await context.close();
});
