import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// U4: readable on a phone (375×812): no sideways page scroll, progress visible.

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const PAGES: { name: string; path: string; ready: RegExp | string }[] = [
  { name: "Releases", path: "/releases", ready: "" },
  { name: "Release board", path: "/releases/e0000023", ready: "Epic: dashboard overhaul" },
  { name: "Epics", path: "/epics", ready: "dashboard overhaul" },
  { name: "Backlog", path: "/backlog", ready: "Bug: crash on start" },
  { name: "Tasks Inbox", path: "/tasks", ready: "" },
];

for (const p of PAGES) {
  test(`375px: ${p.name} has no horizontal page scroll`, async ({ browser }) => {
    const { context, page } = await as(browser);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(p.path);
    await (p.ready ? expect(page.getByText(p.ready).first()) : expect(page.getByRole("heading", { level: 1 }))).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
    await context.close();
  });
}

test("375px: release progress and epic progress are visible", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/releases/e0000023");
  await expect(page.locator("[data-release-summary]")).toBeVisible();
  await expect(page.locator("[data-release-summary]")).toContainText("%");
  await page.goto("/epics");
  await expect(page.locator("[data-epic-progress]").first()).toBeVisible();
  await expect(page.locator("[data-epic-progress]").first()).toContainText("%");
  await context.close();
});

test("375px: a table view shows as a list, the URL keeps the table", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.setViewportSize({ width: 375, height: 812 });
  const s = Buffer.from(JSON.stringify({ filters: [], sort: [], layout: "table" })).toString("base64url");
  await page.goto(`/backlog?s=${s}`);
  await expect(page.getByText("Bug: crash on start")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  expect(await noSideScroll(page)).toBe(true);
  expect(new URL(page.url()).searchParams.get("s")).toBe(s);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("table")).toBeVisible();
  await context.close();
});

test("touch: the reorder handle moves a task", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-e2e-login": "alice" }, viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const stamp = Date.now().toString(36);
  const project = await (await page.request.post("/api/task-projects", { data: { name: `Touch ${stamp}`, color: "blue" } })).json();
  for (const t of ["First", "Second", "Third"]) await page.request.post("/api/tasks", { data: { title: `${t} ${stamp}`, projectId: project.id } });
  await page.goto(`/tasks/p/${project.id}`);
  const titles = () => page.locator("[data-task-row] [data-peek-title]").allInnerTexts();
  await expect.poll(titles).toEqual([`First ${stamp}`, `Second ${stamp}`, `Third ${stamp}`]);
  const handle = page.locator("[data-task-row]").first().locator("[data-drag-handle]");
  await expect(handle).toBeVisible();
  const a = (await handle.boundingBox())!;
  const third = (await page.locator("[data-task-row]").nth(2).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, third.y + 4, { steps: 8 });
  await page.mouse.up();
  await expect.poll(titles).toEqual([`Second ${stamp}`, `First ${stamp}`, `Third ${stamp}`]);
  await context.close();
});

test("375px: the menu drawer moves focus in, traps Tab, closes on Escape and restores focus", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/backlog");
  const opener = page.getByRole("button", { name: "Open menu" });
  await opener.click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  // Focus moved into the drawer.
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  // Focus went back to the button that opened it.
  await expect(opener).toBeFocused();
  await context.close();
});
