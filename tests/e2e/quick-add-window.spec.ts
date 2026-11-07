import { expect, test, type Browser } from "@playwright/test";

// D12: the floating quick-add page (/quick-add) in a plain browser: the same
// parser as in-app quick add, no app shell, Enter saves. (Inside the desktop
// app the same page runs in the global-shortcut window; tests/electron.)

async function asAlice(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-e2e-login": "alice" } });
  return { context, page: await context.newPage() };
}

const unique = (s: string) => `${s} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("Enter saves the parsed task; the page has no app shell", async ({ browser }) => {
  const { context, page } = await asAlice(browser);
  const title = unique("Call the dentist");
  await page.goto("/quick-add");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  const input = page.getByRole("combobox", { name: "Task" });
  await input.fill(`${title} tomorrow 3pm high`);
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST");
  await input.press("Enter");
  expect((await saved).status()).toBe(201);
  const tasks = (await (await page.request.get("/api/tasks")).json()).tasks as { title: string; dueDate: string | null; dueTime: string | null; priority: number }[];
  const t = tasks.find((x) => x.title === title);
  expect(t, "saved with its parsed title").toBeTruthy();
  expect(t).toMatchObject({ dueTime: "15:00", priority: 2 });
  expect(t!.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await context.close();
});

test("an empty title is not saved; Esc outside the desktop app does nothing", async ({ browser }) => {
  const { context, page } = await asAlice(browser);
  await page.goto("/quick-add");
  const input = page.getByRole("combobox", { name: "Task" });
  let posted = false;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/tasks") && r.method() === "POST") posted = true;
  });
  await input.fill("tomorrow");
  await input.press("Enter");
  await input.press("Escape");
  await page.waitForTimeout(300);
  expect(posted).toBe(false);
  await expect(input).toBeVisible();
  await context.close();
});

test("Settings has no Desktop section in a browser", async ({ browser }) => {
  const { context, page } = await asAlice(browser);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "GitHub", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Desktop" })).toHaveCount(0);
  await context.close();
});
