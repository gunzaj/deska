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

// HOME-SPEC §2.1: Home and the three issue lists on top, then a Tasks group and a GitHub group.
test("the sidebar is Home, the issue lists, then the Tasks and GitHub groups", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/my");
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect.poll(() => nav.getByRole("link").evaluateAll((els) => els.slice(0, 4).map((e) => (e.textContent ?? "").replace(/[\d,]+$/, "")))).toEqual(["Home", "Triage", "My issues", "Watching"]);
  await expect.poll(() => nav.getByRole("heading", { level: 2 }).allInnerTexts()).toEqual(["Tasks", "GitHub"]);
  await expect(nav.getByText("Workspace")).toHaveCount(0);

  const tasks = nav.locator('[data-sidebar-group="tasks"]');
  for (const name of ["Inbox", "Today", "Upcoming", "Completed"]) await expect(tasks.getByRole("link", { name, exact: false }).first()).toBeVisible();
  // The Tasks heading carries the task actions; Projects and Labels are its sub-sections.
  for (const name of ["Ramble", "Save view", "New task", "New project", "New label"]) await expect(tasks.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(tasks.getByRole("link", { name: "All issues" })).toHaveCount(0);

  const github = nav.locator('[data-sidebar-group="github"]');
  for (const name of ["All issues", "Backlog", "Releases", "Epics", "Insights"]) await expect(github.getByRole("link", { name, exact: false }).first()).toBeVisible();
  await expect(github.getByRole("link", { name: /^Current · Sprint 23/ })).toBeVisible();
  // The mapped dimension keeps its own name as a sub-section.
  await expect(github.locator('[data-sidebar-section="Team"]')).toBeVisible();
  await expect(github.locator('[data-sidebar-section="Views"]')).toBeVisible();
  await context.close();
});

test("Customize sidebar lists the two groups; a sub-section moves inside its group only", async ({ browser }) => {
  const { context, page } = await as(browser);
  // The layout is cached in the browser and saved to prefs: answer the save here so the shared prefs stay as they are.
  await page.route("**/api/me/prefs", (route) => (route.request().method() === "PATCH" ? route.fulfill({ json: {} }) : route.fallback()));
  await page.goto("/my");
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible();
  await page.getByRole("button", { name: "Customize sidebar" }).click();
  const dialog = page.getByRole("dialog", { name: "Customize sidebar" });
  await expect(dialog.getByRole("list", { name: "Tasks sections" }).getByRole("listitem")).toHaveText(["Task lists", "Projects", "Labels"]);
  await expect(dialog.getByRole("list", { name: "GitHub sections" }).getByRole("listitem")).toHaveText(["Issue lists", "Views", "First dimension"]);
  // The lead has no move buttons; the last sub-section cannot leave its group.
  await expect(dialog.getByRole("button", { name: "Move Task lists up" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Move Labels down" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Move Labels up" }).click();
  await expect(dialog.getByRole("list", { name: "Tasks sections" }).getByRole("listitem")).toHaveText(["Task lists", "Labels", "Projects"]);
  const tasks = page.getByRole("navigation", { name: "Main" }).locator('[data-sidebar-group="tasks"]');
  await expect.poll(() => tasks.locator("[data-sidebar-section]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.sidebarSection))).toEqual(["Labels", "Projects"]);

  // Hiding every GitHub section removes the group's heading.
  for (const name of ["Issue lists", "Views", "First dimension"]) await dialog.getByLabel(`Show ${name}`).uncheck();
  await expect(page.getByRole("navigation", { name: "Main" }).locator('[data-sidebar-group="github"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).locator('[data-sidebar-group="github"]')).toBeVisible();
  await context.close();
});
