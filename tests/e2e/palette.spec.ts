import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// U5: ⌘K finds tasks; the New issue button opens the create form (W3).

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

test("the New issue button opens the create form", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/my");
  await page.locator("[data-new-issue]").click();
  const dialog = page.getByRole("dialog", { name: "Create issue" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Title")).toBeVisible();
  await context.close();
});

test("⌘K finds a task by a word only in its description or in a comment", async ({ browser }) => {
  const { context, page } = await as(browser);
  const stamp = Date.now().toString(36);
  const inDescription = `zebra${stamp}`;
  const inComment = `giraffe${stamp}`;
  const a = await (await page.request.post("/api/tasks", { data: { title: `Palette description ${stamp}`, description: `needs the ${inDescription} report` } })).json();
  const b = await (await page.request.post("/api/tasks", { data: { title: `Palette comment ${stamp}` } })).json();
  await page.request.post(`/api/tasks/${b.task.id}/comments`, { data: { body: `ask about ${inComment}` } });
  expect(a.task.id).not.toBe(b.task.id);

  await page.goto("/my");
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible();
  const input = await openPalette(page);
  await input.fill(inDescription);
  await expect(page.getByRole("option", { name: new RegExp(`Palette description ${stamp}.*in description`) })).toBeVisible();
  await input.fill(inComment);
  const hit = page.getByRole("option", { name: new RegExp(`Palette comment ${stamp}.*in a comment`) });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page.getByRole("complementary", { name: "Task" }).getByLabel("Title")).toHaveValue(`Palette comment ${stamp}`);
  await context.close();
});
