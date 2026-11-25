import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

async function withProjectTitle(page: Page, projectTitle: string) {
  await page.route("**/api/data", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const res = await route.fetch({ headers });
    const json = await res.json();
    json.meta.projectTitle = projectTitle;
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
}

// Improvement 8: the sidebar names the synced project, with the repository
// beneath it; without one it falls back to the app name.
test("the sidebar shows the project title and the repository", async ({ browser }) => {
  const { context, page } = await as(browser);
  await withProjectTitle(page, "Widgets Roadmap");
  await page.goto("/my");
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible();
  const sidebar = page.locator("aside").first();
  await expect(sidebar.getByText("Widgets Roadmap")).toBeVisible();
  await expect(sidebar.getByText("acme/widgets")).toBeVisible();
  await expect(sidebar.getByText("Deska")).toHaveCount(0);
  await context.close();
});

test("a long project title is truncated, not wrapped", async ({ browser }) => {
  const { context, page } = await as(browser);
  const long = "Widgets Roadmap for the international checkout and account hierarchy programme";
  await withProjectTitle(page, long);
  await page.goto("/my");
  const title = page.locator("aside").getByText(long);
  await expect(title).toBeVisible();
  await expect(title).toHaveAttribute("title", long);
  await expect(title).toHaveCSS("text-overflow", "ellipsis");
  await expect(title).toHaveCSS("white-space", "nowrap");
  await context.close();
});

test("without a project the sidebar falls back to Deska and the repository", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/my");
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible();
  const sidebar = page.locator("aside").first();
  await expect(sidebar.getByText("Deska", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("acme/widgets")).toBeVisible();
  await context.close();
});

// HOME-SPEC §2.5: Favorites (Home and the three issue lists by default) on top, then the sections, each with its own heading.
test("the sidebar is Favorites, then the sections in their default order", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/my");
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect.poll(() => nav.getByRole("link").evaluateAll((els) => els.slice(0, 4).map((e) => (e.textContent ?? "").replace(/[\d,]+$/, "")))).toEqual(["Home", "Triage", "My issues", "Watching"]);
  await expect.poll(() => nav.getByRole("heading", { level: 2 }).allInnerTexts()).toEqual(["Favorites", "Tasks", "Projects", "Labels", "GitHub", "Views", "Team"]);
  await expect(nav.getByText("Workspace")).toHaveCount(0);

  const tasks = nav.locator('[data-sidebar-section="Tasks"]');
  for (const name of ["Inbox", "Today", "Upcoming", "Completed"]) await expect(tasks.getByRole("link", { name, exact: false }).first()).toBeVisible();
  // The Tasks heading carries the task actions; Projects and Labels have their own "+".
  for (const name of ["Ramble", "Save view", "New task"]) await expect(tasks.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(nav.locator('[data-sidebar-section="Projects"]').getByRole("button", { name: "New project", exact: true })).toBeVisible();
  await expect(nav.locator('[data-sidebar-section="Labels"]').getByRole("button", { name: "New label", exact: true })).toBeVisible();
  await expect(tasks.getByRole("link", { name: "All issues" })).toHaveCount(0);

  const github = nav.locator('[data-sidebar-section="GitHub"]');
  for (const name of ["All issues", "Backlog", "Releases", "Epics", "Insights"]) await expect(github.getByRole("link", { name, exact: false }).first()).toBeVisible();
  await expect(github.getByRole("link", { name: /^Current · Sprint 23/ })).toBeVisible();
  await context.close();
});

test("Customize sidebar is one list; a section moves anywhere, past the task and GitHub sections alike", async ({ browser }) => {
  const { context, page } = await as(browser);
  // The layout is cached in the browser and saved to prefs: answer the save here so the shared prefs stay as they are.
  await page.route("**/api/me/prefs", (route) => (route.request().method() === "PATCH" ? route.fulfill({ json: {} }) : route.fallback()));
  await page.goto("/my");
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  const order = () => nav.locator("[data-sidebar-section]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.sidebarSection));
  await page.getByRole("button", { name: "Customize sidebar" }).click();
  const dialog = page.getByRole("dialog", { name: "Customize sidebar" });
  const list = dialog.getByRole("list", { name: "Sidebar sections" }).getByRole("listitem");
  await expect(list).toHaveText(["Tasks", "Projects", "Labels", "GitHub", "Views", "First dimension"]);
  await expect(dialog.getByRole("button", { name: "Move Tasks up" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Move First dimension down" })).toBeDisabled();

  // GitHub goes above Projects, and Tasks below Views: no section is tied to a group.
  for (let i = 0; i < 3; i++) await dialog.getByRole("button", { name: "Move GitHub up" }).click();
  for (let i = 0; i < 3; i++) await dialog.getByRole("button", { name: "Move Tasks down" }).click();
  await expect(list).toHaveText(["GitHub", "Projects", "Labels", "Views", "Tasks", "First dimension"]);
  await expect.poll(order).toEqual(["Favorites", "GitHub", "Projects", "Labels", "Views", "Tasks", "Team"]);

  // A hidden section is gone from the sidebar; Reset brings the default back.
  await dialog.getByLabel("Show GitHub").uncheck();
  await expect(nav.locator('[data-sidebar-section="GitHub"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "Reset" }).click();
  await expect.poll(order).toEqual(["Favorites", "Tasks", "Projects", "Labels", "GitHub", "Views", "Team"]);
  await context.close();
});

// HOME-SPEC §2.4: any sidebar item can be starred, and every list is reordered by dragging.
test("favorites: star and unstar an item, and drag to reorder a list", async ({ browser }) => {
  // Tall enough to show the whole sidebar: a drag that scrolls the list mid-way picks up the wrong row in the test.
  const { context, page } = await as(browser, "alice", { viewport: { width: 1280, height: 1500 } });
  // Answer the save here so the shared prefs stay as they are.
  await page.route("**/api/me/prefs", (route) => (route.request().method() === "PATCH" ? route.fulfill({ json: {} }) : route.fallback()));
  await page.goto("/my");
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  const keys = (list: string) => nav.locator(`[data-nav-list="${list}"] [data-nav-item]`).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.navItem));
  const item = (key: string) => nav.locator(`[data-nav-item="${key}"]`);
  const above = { targetPosition: { x: 40, y: 3 } };
  await expect.poll(() => keys("favorites")).toEqual(["/home", "/triage", "/my", "/watching"]);

  // Unstarred, Triage goes back to the GitHub lists; a starred page leaves its section.
  await item("/triage").getByRole("button", { name: "Unfavorite" }).click();
  await expect.poll(() => keys("favorites")).toEqual(["/home", "/my", "/watching"]);
  await expect.poll(async () => (await keys("workspace"))[0]).toBe("/triage");
  await item("/epics").getByRole("button", { name: "Favorite", exact: true }).click();
  await expect.poll(() => keys("favorites")).toEqual(["/home", "/my", "/watching", "/epics"]);
  await expect.poll(() => keys("workspace")).not.toContain("/epics");

  // Favorites are reordered by dragging.
  await item("/epics").dragTo(item("/home"), above);
  await expect.poll(() => keys("favorites")).toEqual(["/epics", "/home", "/my", "/watching"]);

  // So is a section: the second saved view goes above the first.
  const views = await keys("views");
  expect(views.length).toBeGreaterThan(1);
  await item(views[1]!).dragTo(item(views[0]!), above);
  await expect.poll(() => keys("views")).toEqual([views[1], views[0], ...views.slice(2)]);

  // A drop on Favorites stars the item; a drop on another section does nothing.
  await item(views[0]!).dragTo(item("/my"), above);
  await expect.poll(() => keys("favorites")).toEqual(["/epics", "/home", views[0], "/my", "/watching"]);
  await item("/issues").dragTo(item("/tasks/today"), above);
  await expect.poll(() => keys("tasks")).not.toContain("/issues");
  await context.close();
});
