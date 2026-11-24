import { expect, test, type Page } from "@playwright/test";
import { as, writesOn } from "./helpers";

// In-app tabs: ⌘-click or middle-click opens an issue in a background tab,
// ⌘⇧-click opens and switches, and each tab keeps its own history. The
// fixture epic #100 has one child, #101 "Sub: dashboard widget".

const tabs = (page: Page) => page.getByRole("tablist", { name: "Open tabs" }).getByRole("tab");
const panel = (page: Page, n: number) => page.getByRole("complementary", { name: `Issue #${n}` });

test("⌘-click on a sub-issue opens it in a background tab; the parent stays in the panel", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog?issue=100");
  await expect(tabs(page)).toHaveCount(0);
  const child = page.locator("[data-sub-issue='101'] [data-tab-issue]");
  await child.click({ modifiers: ["ControlOrMeta"] });
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toContainText("#101 Sub: dashboard widget");
  await expect(tabs(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/backlog\?issue=100$/);
  await expect(panel(page, 100)).toBeVisible();

  // The same issue again is not a second tab: the existing one flashes
  // (once the flash from opening it is over, so this one is its own).
  await expect(tabs(page).nth(1)).not.toHaveAttribute("data-flash", "");
  await child.click({ modifiers: ["ControlOrMeta"] });
  await expect(tabs(page)).toHaveCount(2);
  await expect(tabs(page).nth(1)).toHaveAttribute("data-flash", "");

  // Switching shows the issue's page; ⌘1 brings the parent back with its panel.
  await tabs(page).nth(1).click();
  await expect(page).toHaveURL(/\/issues\/101$/);
  await page.keyboard.press("ControlOrMeta+1");
  await expect(page).toHaveURL(/\/backlog\?issue=100$/);
  await expect(panel(page, 100)).toBeVisible();
  await context.close();
});

test("in an issue tab a plain click opens the child in the side panel over the parent's page", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/issues/100");
  await page.locator("[data-sub-issue='101'] [data-tab-issue]").click();
  await expect(page).toHaveURL(/\/issues\/100\?issue=101$/);
  await expect(panel(page, 101)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Epic: dashboard overhaul" })).toBeVisible();
  // The parent trail in the panel does the same: the panel moves, the page stays.
  await panel(page, 101).getByRole("navigation", { name: "Parent issues" }).getByRole("button").click();
  await expect(page).toHaveURL(/\/issues\/100\?issue=100$/);
  await context.close();
});

test("a page outside the app shell never becomes a tab; + opens the home page with its own history", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/issues");
  await expect(page.locator("[data-issue='102']")).toBeVisible();
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "/onboarding";
    a.id = "out";
    a.textContent = "out";
    // Not a tab, so the click is left alone: keep the browser from following it.
    a.addEventListener("auxclick", (e) => e.preventDefault());
    document.querySelector("main")!.prepend(a);
  });
  await page.locator("#out").click({ button: "middle" });
  await page.locator("[data-issue='102'] [data-peek-title]").click({ modifiers: ["ControlOrMeta"] });
  await expect(tabs(page)).toHaveCount(2);

  // + on the start page (Home): the new tab shows the same URL, and still gets its own history.
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(tabs(page)).toHaveCount(3);
  const fresh = tabs(page).and(page.locator('[aria-selected="true"]'));
  await expect(fresh).toContainText("Home");
  await page.getByRole("link", { name: "Backlog" }).first().click();
  await expect(page).toHaveURL(/\/backlog$/);
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await expect(page).toHaveURL(/\/home$/);
  await context.close();
});

test("middle-click on a list row opens a tab; ⌘⇧-click opens one and switches to it", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/issues");
  await page.locator("[data-issue='102']").click({ button: "middle" });
  await expect(tabs(page)).toHaveCount(2);
  await expect(page).toHaveURL(/\/issues$/);
  await page.locator("[data-issue='101'] [data-peek-title]").click({ modifiers: ["ControlOrMeta", "Shift"] });
  await expect(tabs(page)).toHaveCount(3);
  await expect(page).toHaveURL(/\/issues\/101$/);
  // Background tabs line up after the tab that opened them, in order.
  await expect(tabs(page).nth(2)).toHaveAttribute("aria-selected", "true");
  await context.close();
});

test("with bulk edit on, ⌘-click on the title opens a tab and elsewhere on the row still selects it", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  await page.goto("/issues");
  const row = page.locator("[data-issue='102']");
  await row.locator("[data-peek-title]").click({ modifiers: ["ControlOrMeta"] });
  await expect(tabs(page)).toHaveCount(2);
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  const box = await row.boundingBox();
  await row.click({ modifiers: ["ControlOrMeta"], position: { x: box!.width - 20, y: box!.height / 2 } });
  await expect(row.getByRole("checkbox")).toBeChecked();
  await expect(tabs(page)).toHaveCount(2);
  await context.close();
});

test("⌘W closes the active tab, ⌘⇧T reopens it, ⌘[ and ⌘] walk the tab's own history", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/issues");
  await page.locator("[data-issue='102'] [data-peek-title]").click({ modifiers: ["ControlOrMeta", "Shift"] });
  await expect(page).toHaveURL(/\/issues\/102$/);
  await page.keyboard.press("ControlOrMeta+w");
  await expect(tabs(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/issues$/);
  await page.keyboard.press("ControlOrMeta+Shift+t");
  await expect(page).toHaveURL(/\/issues\/102$/);
  await expect(tabs(page)).toHaveCount(2);

  await page.keyboard.press("ControlOrMeta+1");
  await expect(page).toHaveURL(/\/issues$/);
  await page.getByRole("link", { name: "Backlog" }).first().click();
  await expect(page).toHaveURL(/\/backlog$/);
  await page.keyboard.press("ControlOrMeta+BracketLeft");
  await expect(page).toHaveURL(/\/issues$/);
  await page.keyboard.press("ControlOrMeta+BracketRight");
  await expect(page).toHaveURL(/\/backlog$/);
  await context.close();
});

test("the panel shows the parent trail, and ← Back after moving from issue to issue inside it", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog?issue=100");
  await expect(page.locator("[data-panel-back]")).toHaveCount(0);
  await page.locator("[data-sub-issue='101'] [data-tab-issue]").click();
  await expect(panel(page, 101)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Parent issues" })).toContainText("dashboard overhaul");
  await page.getByRole("button", { name: "Back to #100" }).click();
  await expect(panel(page, 100)).toBeVisible();
  await expect(page.locator("[data-panel-back]")).toHaveCount(0);

  // Opening from the list is not a step inside the panel: no ← Back.
  await page.goto("/issues?issue=101");
  await expect(panel(page, 101)).toBeVisible();
  await expect(page.locator("[data-panel-back]")).toHaveCount(0);
  await context.close();
});
