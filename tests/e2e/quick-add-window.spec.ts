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

test("every property can be set with the mouse; a pick wins over the typed word", async ({ browser }) => {
  const { context, page } = await asAlice(browser);
  const projectName = unique("Mouse project");
  const labelName = unique("mouse-label").replace(/\s+/g, "-");
  const project = (await (await page.request.post("/api/task-projects", { data: { name: projectName } })).json()) as { id: string };
  const label = (await (await page.request.post("/api/task-labels", { data: { name: labelName } })).json()) as { id: string };
  const title = unique("Water the plants");
  await page.goto("/quick-add");
  const input = page.getByRole("combobox", { name: "Task" });
  // "low" is parsed; the priority picker below overrides it.
  await input.fill(`${title} low`);
  await expect(page.getByRole("button", { name: "Priority: P4 Low" })).toBeVisible();

  await page.getByLabel("Due date").fill("2030-03-04");
  await page.getByLabel("Due time").fill("09:30");
  await page.getByRole("button", { name: "Set repeat" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Every week on/ }).click();
  await page.getByRole("button", { name: "Priority: P4 Low" }).click();
  await page.getByRole("option", { name: "P1 · Urgent" }).click();
  await page.getByRole("button", { name: "Project: Inbox" }).click();
  await page.getByRole("option", { name: projectName }).click();
  await page.getByRole("button", { name: "Labels" }).click();
  await page.getByRole("option", { name: labelName }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: `Project: ${projectName}` })).toBeVisible();

  const saved = page.waitForResponse((r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Add task" }).click();
  expect((await saved).status()).toBe(201);
  const tasks = (await (await page.request.get("/api/tasks")).json()).tasks as Record<string, unknown>[];
  const t = tasks.find((x) => x.title === title);
  expect(t, "saved with the typed title").toBeTruthy();
  expect(t).toMatchObject({ dueTime: "09:30", priority: 1, projectId: project.id, labels: [label.id] });
  expect(t!.recurrence).toMatchObject({ rule: "FREQ=WEEKLY;BYDAY=MO" });
  expect(t!.dueDate).toMatch(/^2030-03-/);
  await context.close();
});

test("the window shows the same form as the in-app quick add", async ({ browser }) => {
  const { context, page } = await asAlice(browser);
  const controls = async (root: ReturnType<typeof page.locator>) => ({
    task: await root.getByRole("combobox", { name: "Task" }).count(),
    due: await root.getByLabel("Due date").count(),
    repeat: await root.getByRole("button", { name: "Set repeat" }).count(),
    priority: await root.getByRole("button", { name: /^Priority:/ }).count(),
    project: await root.getByRole("button", { name: /^Project:/ }).count(),
    labels: await root.getByRole("button", { name: "Labels" }).count(),
    description: await root.getByRole("button", { name: "+ Description" }).count(),
    ai: await root.locator("[data-ai-assist]").count(),
    another: await root.getByRole("button", { name: "Add another" }).count(),
    add: await root.getByRole("button", { name: "Add task" }).count(),
  });
  await page.goto("/quick-add");
  await expect(page.getByRole("combobox", { name: "Task" })).toBeVisible();
  const floating = await controls(page.locator("[data-quick-add]"));
  await page.goto("/tasks");
  // The sidebar's +.
  await page.getByRole("navigation").getByRole("button", { name: "New task" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.getByRole("combobox", { name: "Task" })).toBeVisible();
  expect(floating).toEqual(await controls(dialog));
  expect(Object.values(floating).every((n) => n === 1)).toBe(true);
  await context.close();
});

test("Settings has no Desktop section in a browser", async ({ browser }) => {
  const { context, page } = await asAlice(browser);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "GitHub", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Desktop" })).toHaveCount(0);
  await context.close();
});
