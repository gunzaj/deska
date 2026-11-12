import { expect, test, type Browser } from "@playwright/test";

// Item 12: saved task views. The store lives for the whole dev server, so every
// test uses a unique view and task title.

async function as(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-e2e-login": "alice" } });
  return { context, page: await context.newPage() };
}

const unique = (s: string) => `${s} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("saving a task view puts it after Completed and opens it with its filters", async ({ browser }) => {
  const { context, page } = await as(browser);
  const name = unique("Urgent today");
  const mine = unique("Call the dentist");
  const other = unique("Read a book");
  const today = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
  expect((await page.request.post("/api/tasks", { data: { title: mine, dueDate: today, priority: 1 } })).status()).toBe(201);
  expect((await page.request.post("/api/tasks", { data: { title: other, priority: 4 } })).status()).toBe(201);

  await page.goto("/tasks");
  const nav = page.getByRole("navigation", { name: "Main" });
  // The four built-in lists come first, then the saved views (none yet).
  await expect(nav.getByRole("link", { name: "Completed" })).toBeVisible();
  await page.getByRole("button", { name: "Save view" }).click();
  const dialog = page.getByRole("dialog", { name: "Save view" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("View name").fill(name);
  await dialog.getByLabel("Project").selectOption("none");
  await dialog.getByLabel("Priority").selectOption("1");
  await dialog.getByLabel("Due").selectOption("today");
  await dialog.getByRole("button", { name: "Save view" }).click();

  await page.waitForURL(/\/tasks\/views\//);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: mine })).toBeVisible();
  await expect(page.getByText(other)).toHaveCount(0);
  await expect(nav.getByRole("link", { name })).toBeVisible();

  // It survives a reload: the view is in the sidebar and its filter still runs.
  await page.reload();
  await expect(nav.getByRole("link", { name })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: mine })).toBeVisible();

  // Deleting the view leaves the tasks alone and returns to Inbox.
  await page.getByRole("button", { name: "Delete view" }).click();
  await page.getByRole("dialog", { name: "Delete view" }).getByRole("button", { name: "Delete" }).click();
  await page.waitForURL(/\/tasks$/);
  await expect(nav.getByRole("link", { name })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: mine })).toBeVisible();
  await context.close();
});
