import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// U2: no serious or critical axe violations on the main screens.

async function audit(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact} ${v.id}: ${v.help} — ${v.nodes.length} node(s): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

const SCREENS: { name: string; go: (page: Page) => Promise<void> }[] = [
  { name: "Board", go: async (page) => { await page.goto("/releases/e0000023"); await expect(page.getByText("Epic: dashboard overhaul")).toBeVisible(); } },
  { name: "Backlog", go: async (page) => { await page.goto("/backlog"); await expect(page.getByText("Bug: crash on start")).toBeVisible(); } },
  { name: "Tasks Inbox", go: async (page) => { await page.goto("/tasks"); await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible(); } },
  { name: "Onboarding", go: async (page) => { await page.goto("/onboarding"); await expect(page.getByRole("heading", { name: "How to create it" })).toBeVisible(); } },
  { name: "Settings", go: async (page) => { await page.goto("/settings"); await expect(page.getByRole("heading", { name: "GitHub", exact: true })).toBeVisible(); } },
  {
    name: "Issue panel",
    go: async (page) => {
      await page.goto("/backlog?issue=102");
      await expect(page.getByRole("complementary", { name: "Issue #102" })).toBeVisible();
    },
  },
  {
    name: "Task panel",
    go: async (page) => {
      const r = await page.request.post("/api/tasks", { data: { title: `a11y task ${Date.now()}` } });
      const id = (await r.json()).task.id;
      await page.goto(`/tasks?task=${id}`);
      await expect(page.getByRole("complementary", { name: "Task" })).toBeVisible();
    },
  },
];

for (const s of SCREENS) {
  test(`axe: ${s.name} has no serious or critical violations`, async ({ browser }) => {
    const { context, page } = await as(browser);
    // No fade-ins mid-audit: axe would measure contrast at partial opacity.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await s.go(page);
    expect(await audit(page)).toEqual([]);
    await context.close();
  });
}

test("Tab reaches the first issue row; Enter opens the panel; Esc closes it and focus is back on the row", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog");
  const first = page.locator("[data-row-id]").first();
  await expect(first).toBeVisible();
  const firstNumber = await first.getAttribute("data-issue");
  // Tab from the start of the page until the first row has focus.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  let reached = false;
  for (let n = 0; n < 80 && !reached; n++) {
    await page.keyboard.press("Tab");
    reached = await first.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: `Issue #${firstNumber}` });
  await expect(panel).toBeVisible();
  // Focus moved into the panel (its heading).
  await expect.poll(() => panel.evaluate((p) => p.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-issue"))).toBe(firstNumber);
  await context.close();
});

test("Tab inside the quick-add dialog never leaves it", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog).toBeVisible();
  for (let n = 0; n < 25; n++) {
    await page.keyboard.press(n % 3 === 2 ? "Shift+Tab" : "Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await context.close();
});

test("Alt+↓ moves a task down and the order survives a reload", async ({ browser }) => {
  const { context, page } = await as(browser);
  const stamp = Date.now().toString(36);
  const project = await (await page.request.post("/api/task-projects", { data: { name: `Order ${stamp}`, color: "blue" } })).json();
  for (const t of ["First", "Second", "Third"]) await page.request.post("/api/tasks", { data: { title: `${t} ${stamp}`, projectId: project.id } });
  await page.goto(`/tasks/p/${project.id}`);
  const titles = () => page.locator("[data-task-row] [data-peek-title]").allInnerTexts();
  await expect.poll(titles).toEqual([`First ${stamp}`, `Second ${stamp}`, `Third ${stamp}`]);
  await page.locator("[data-task-row]").first().focus();
  // The reorder is optimistic; wait for the server to have the new position before reloading.
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && /\/api\/tasks\/[^/]+$/.test(new URL(r.url()).pathname) && r.ok());
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(titles).toEqual([`Second ${stamp}`, `First ${stamp}`, `Third ${stamp}`]);
  // Focus stays on the moved task.
  await expect.poll(() => page.evaluate(() => document.activeElement?.textContent ?? "")).toContain(`First ${stamp}`);
  await saved;
  await page.reload();
  await expect.poll(titles).toEqual([`Second ${stamp}`, `First ${stamp}`, `Third ${stamp}`]);
  await context.close();
});
