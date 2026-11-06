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

test("PRs waiting for review: the N-days picker is in the URL", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/insights");
  const tile = page.locator("[data-review-wait]");
  await expect(tile).toBeVisible();
  await expect(tile.getByRole("button", { name: "5 days" })).toHaveAttribute("aria-pressed", "true");
  await tile.getByRole("button", { name: "10 days" }).click();
  await expect(page).toHaveURL(/days=10/);
  await expect(tile.getByRole("button", { name: "10 days" })).toHaveAttribute("aria-pressed", "true");
  await tile.getByRole("button", { name: "2 days" }).click();
  await expect(page).toHaveURL(/days=2/);
  await expect(tile.locator("[data-review-wait-total]")).not.toHaveText("…");
  await context.close();
});
