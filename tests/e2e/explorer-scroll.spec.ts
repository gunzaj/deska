import { expect, test, type Page } from "@playwright/test";
import { as, writesOn } from "./helpers";

// The list scrolls to a row only when the keyboard moves the focus (or the side
// panel opens an issue). The mouse must never scroll it: hovering a row near
// the top edge used to pull the list up, one row per mouse move.

const scroller = (page: Page) => page.locator("[role=list][aria-label=Issues]").locator("xpath=..");
const scrollTop = (page: Page) => scroller(page).evaluate((el) => el.scrollTop);

test("moving the mouse over a scrolled list does not scroll it; j still brings the focused row into view", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    await writesOn(page, { extraIssues: 200 });
    await page.goto("/issues");
    await expect(page.locator("[data-row-id]").first()).toBeVisible();
    await scroller(page).evaluate((el) => {
      el.scrollTop = 2000;
    });
    await expect.poll(() => scrollTop(page)).toBe(2000);
    const box = (await scroller(page).boundingBox())!;
    // The row cut by the list's top edge: the one the old code scrolled to on hover.
    const edge = async () => {
      const rects = await page.locator("[data-row-key]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom, left: r.left })));
      return rects.find((r) => r.top < box.y + 30 && r.bottom > box.y + 6);
    };
    await expect.poll(async () => !!(await edge())).toBe(true);
    for (let i = 0; i < 4; i++) {
      const row = (await edge())!;
      await page.mouse.move(row.left + 300, Math.max(row.top, box.y) + 4 + i * 3);
      await page.waitForTimeout(100);
    }
    // The hover did focus a row, so this is not a test of a mouse that hit nothing.
    await expect(page.locator("[data-row-key][aria-current=true]")).toHaveCount(1);
    expect(await scrollTop(page)).toBe(2000);

    // The keyboard still scrolls: back at the top, enough steps down to leave the viewport.
    await scroller(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.mouse.move(box.x + 300, box.y + 60);
    for (let i = 0; i < 60; i++) await page.keyboard.press("j");
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
