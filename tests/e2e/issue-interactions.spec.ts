import { test, expect } from "@playwright/test";
import { as } from "./helpers";

// Improvement 1: a title always looks clickable, and the issue open in the side
// panel stays highlighted while only another title swaps it.
test("a title looks clickable with the side panel open and closed", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog");
  const row101 = page.locator('[data-issue="101"]');
  const title101 = row101.locator("[data-peek-title]");
  const row102 = page.locator('[data-issue="102"]');
  const title102 = row102.locator("[data-peek-title]");

  // Closed: the pointer is a hand and the title underlines on hover.
  await expect(title101).toHaveCSS("cursor", "pointer");
  await title101.hover();
  await expect(title101).toHaveCSS("text-decoration-line", "underline");
  await expect(page.locator("[data-peeked]")).toHaveCount(0);

  // Opening the panel highlights the row in the list.
  await title101.click();
  await expect(page).toHaveURL(/[?&]issue=101/);
  await expect(row101).toHaveAttribute("data-peeked", "");
  await expect(title101).toHaveCSS("cursor", "pointer");
  await title101.hover();
  await expect(title101).toHaveCSS("text-decoration-line", "underline");

  // With the panel open, the rest of a row does not open its issue: it closes the
  // panel instead, and the title still swaps the issue.
  await row102.click({ position: { x: 30, y: 20 } });
  await expect(page).not.toHaveURL(/issue=102/);
  await expect(page.locator("[data-peeked]")).toHaveCount(0);

  await title102.click();
  await expect(page).toHaveURL(/[?&]issue=102/);
  await expect(row102).toHaveAttribute("data-peeked", "");
  await expect(row101).not.toHaveAttribute("data-peeked", "");

  // Closing the panel removes the highlight; the title still looks clickable.
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-side-panel]")).toHaveCount(0);
  await expect(page.locator("[data-peeked]")).toHaveCount(0);
  await expect(title102).toHaveCSS("cursor", "pointer");
  await context.close();
});
