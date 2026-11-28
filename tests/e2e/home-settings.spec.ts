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

test("Customize Home: drag a panel, resize it and hide one; the layout survives a reload", async ({ browser }) => {
  // Tall enough to show every panel: a drag that scrolls between mouse-down and
  // mouse-up never starts (the same note as the sidebar drag test).
  const { context, page } = await as(browser, "alice", { viewport: { width: 1280, height: 2400 } });
  await page.goto("/home");
  const panels = () => page.locator("[data-home-panel]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.homePanel));
  const widget = (id: string) => page.locator(`[data-home-widget="${id}"]`);
  await expect.poll(panels).toEqual(["work", "sprint", "epics", "calendar", "attention", "changes"]);

  await page.getByRole("button", { name: "Customize Home" }).click();
  await expect(page.locator("[data-home-edit]")).toHaveCount(6);

  // Hide Epics: it leaves the grid and waits in the Hidden strip.
  let done = saved(page);
  await page.getByRole("button", { name: "Hide Epics in this sprint" }).click();
  await done;
  await expect.poll(panels).toEqual(["work", "sprint", "calendar", "attention", "changes"]);
  await expect(page.getByRole("button", { name: "Show Epics in this sprint" })).toBeVisible();

  // Resize My work to full width.
  done = saved(page);
  await page.getByLabel("Size of My work").selectOption("full");
  await done;
  await expect(widget("work")).toHaveAttribute("data-size", "full");

  // Drag What changed to the top: a drop in the top half lands before My work.
  done = saved(page);
  await page.locator('[data-home-drag="changes"]').dragTo(widget("work"), { targetPosition: { x: 20, y: 5 } });
  await done;
  await expect.poll(panels).toEqual(["changes", "work", "sprint", "calendar", "attention"]);

  // The arrow buttons move a panel too, without a mouse.
  done = saved(page);
  await page.getByRole("button", { name: "Move What changed down" }).click();
  await done;
  await expect.poll(panels).toEqual(["work", "changes", "sprint", "calendar", "attention"]);

  // Bringing Epics back returns it to its stored slot.
  done = saved(page);
  await page.getByRole("button", { name: "Show Epics in this sprint" }).click();
  await done;
  await expect.poll(panels).toEqual(["work", "changes", "sprint", "epics", "calendar", "attention"]);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("[data-home-edit]")).toHaveCount(0);

  await page.reload();
  await expect.poll(panels).toEqual(["work", "changes", "sprint", "epics", "calendar", "attention"]);
  await expect(widget("work")).toHaveAttribute("data-size", "full");
  // The tiles are not part of the layout.
  await expect(page.locator("[data-home-tile]")).toHaveCount(5);

  await page.getByRole("button", { name: "Customize Home" }).click();
  done = saved(page);
  await page.getByRole("button", { name: "Reset" }).click();
  await done;
  await page.getByRole("button", { name: "Done" }).click();
  await expect.poll(panels).toEqual(["work", "sprint", "epics", "calendar", "attention", "changes"]);
  await expect(widget("work")).toHaveAttribute("data-size", "wide");
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
