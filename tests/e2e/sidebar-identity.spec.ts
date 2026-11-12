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
