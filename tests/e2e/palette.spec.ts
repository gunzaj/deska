import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// U5: ⌘K finds tasks; the New issue link uses the configured repo.

async function openPalette(page: Page) {
  const input = page.getByLabel("Search commands and issues");
  // The shortcut listener attaches after hydration; retry until the palette opens.
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(input).toBeVisible({ timeout: 1000 });
  }).toPass();
  return input;
}

test("⌘K finds a task by title", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = `Palette task ${Date.now().toString(36)}`;
  await page.request.post("/api/tasks", { data: { title } });
  await page.goto("/my");
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible();
  const input = await openPalette(page);
  await input.fill(title);
  await page.getByRole("option", { name: title, exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Task" }).getByLabel("Title")).toHaveValue(title);
  await context.close();
});

test("the New issue link points at the configured repo", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/my");
  const repo = (await (await page.request.get("/api/data")).json()).meta.repo;
  await expect(page.locator("[data-new-issue]")).toHaveAttribute("href", `https://github.com/${repo}/issues/new`);
  await expect(page.locator("[data-new-issue]")).toHaveAttribute("target", "_blank");
  await context.close();
});
