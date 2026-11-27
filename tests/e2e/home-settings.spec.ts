import { expect, test } from "@playwright/test";
import { as, resetSharedSettings } from "./helpers";

// HOME-SPEC §3.1 and §5: the start page and the Home layout are prefs the whole
// server shares, so this spec runs on the settings server, one test at a time.
test.beforeEach(({ request }) => resetSharedSettings(request));
test.afterEach(({ request }) => resetSharedSettings(request));

const saved = (page: import("@playwright/test").Page) => page.waitForResponse((r) => r.url().includes("/api/me/prefs") && r.request().method() === "PATCH" && r.ok());

test("Start page: My issues makes Deska open on My issues; Today on Today; Home again by default", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/settings");
  const start = page.getByLabel("Start page");
  await expect(start).toHaveValue("home");
  let done = saved(page);
  await start.selectOption("my");
  await done;
  await page.goto("/");
  await expect(page).toHaveURL(/\/my$/);
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByLabel("Start page")).toHaveValue("my");
  done = saved(page);
  await page.getByLabel("Start page").selectOption("today");
  await done;
  await page.goto("/");
  await expect(page).toHaveURL(/\/tasks\/today$/);

  await page.goto("/settings");
  done = saved(page);
  await page.getByLabel("Start page").selectOption("home");
  await done;
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
  await context.close();
});

test("Customize Home hides and reorders panels, and the layout survives a reload", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/home");
  const panels = () => page.locator("[data-home-panel]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.homePanel));
  await expect.poll(panels).toEqual(["work", "sprint", "epics", "calendar", "attention", "changes"]);

  await page.getByRole("button", { name: "Customize Home" }).click();
  const dialog = page.getByRole("dialog", { name: "Customize Home" });
  let done = saved(page);
  await dialog.getByLabel("Show Epics in this sprint").uncheck();
  await done;
  done = saved(page);
  await dialog.getByRole("button", { name: "Move Current sprint up" }).click();
  await done;
  await expect(dialog.getByRole("button", { name: "Move Current sprint up" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect.poll(panels).toEqual(["sprint", "work", "calendar", "attention", "changes"]);
  // The tiles are not part of the layout.
  await expect(page.locator("[data-home-tile]")).toHaveCount(5);

  await page.reload();
  await expect.poll(panels).toEqual(["sprint", "work", "calendar", "attention", "changes"]);

  await page.getByRole("button", { name: "Customize Home" }).click();
  done = saved(page);
  await dialog.getByRole("button", { name: "Reset" }).click();
  await done;
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect.poll(panels).toEqual(["work", "sprint", "epics", "calendar", "attention", "changes"]);
  await context.close();
});

test("the sprint panel follows the default team, with a chip that turns it off", async ({ browser }) => {
  const { context, page } = await as(browser);
  const data = await (await page.request.get("/api/data")).json();
  // Fixture: #100 (the sprint's one issue) is in Core; nothing is in Checkout.
  const checkout = data.meta.dimensions[0].options[1].id as string;
  expect((await page.request.patch("/api/me/prefs", { data: { defaultTeam: checkout } })).ok()).toBe(true);
  await page.goto("/home");
  const panel = page.locator('[data-home-panel="sprint"]');
  await expect(panel.locator("[data-home-sprint-scope]")).toContainText("Checkout · 0 / 1");
  await expect(panel.locator("[data-home-sprint-done]")).toContainText("0 / 0");
  await panel.locator("[data-team-scope-chip]").click();
  await expect(panel.locator("[data-home-sprint-scope]")).toHaveCount(0);
  await expect(panel.locator("[data-home-sprint-done]")).toContainText("0 / 1");
  await context.close();
});
