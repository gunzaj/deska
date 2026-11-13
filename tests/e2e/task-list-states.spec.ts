// Task lists keep loading, empty and error apart (SPEC §4.2, issue #7 part 2):
// a failed first load shows the reason and Retry, never "Loading tasks…" forever.
import { expect, test, type Page, type Route } from "@playwright/test";

// Signed in as the e2e stand-in user, like the other task specs.
test.use({ extraHTTPHeaders: { "x-e2e-login": "alice" } });

const fail = (route: Route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "database unavailable" }) });

async function expectLoadError(page: Page) {
  const state = page.locator('[data-list-state="error"]');
  await expect(state).toBeVisible();
  await expect(state).toHaveAttribute("role", "alert");
  await expect(state).toContainText("Couldn't load tasks");
  await expect(state).toContainText("database unavailable");
  await expect(page.getByText("Loading tasks…")).toHaveCount(0);
  await expect(page.locator('[data-list-state="loading"]')).toHaveCount(0);
}

for (const path of ["/tasks", "/tasks/today", "/tasks/upcoming"]) {
  test(`${path}: a failed load is an error with Retry, not endless loading`, async ({ page }) => {
    await page.route("**/api/tasks", fail);
    await page.goto(path);
    await expectLoadError(page);

    // Retry once the server answers again: the list loads and the error goes.
    await page.unroute("**/api/tasks", fail);
    await page.locator('[data-list-state="error"]').getByRole("button", { name: "Retry" }).click();
    await expect(page.locator('[data-list-state="error"]')).toHaveCount(0);
    await expect(page.locator('[data-list-state="loading"]')).toHaveCount(0);
  });
}

test("a project page whose tasks fail to load shows the error, not 'Loading…'", async ({ page }) => {
  await page.route("**/api/tasks", fail);
  await page.goto("/tasks/p/does-not-matter");
  await expectLoadError(page);
});

test("while the first load runs, the list says so and is marked busy", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/tasks", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/tasks");
  const loading = page.locator('[data-list-state="loading"]');
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("role", "status");
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(page.locator('[data-list-state="error"]')).toHaveCount(0);
  release();
  await expect(loading).toHaveCount(0);
});

test("an empty list is the empty state, not loading or error", async ({ page }) => {
  await page.route("**/api/tasks", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tasks: [], projects: [], labels: [], sections: [] }) }),
  );
  await page.goto("/tasks/today");
  await expect(page.locator('[data-list-state="empty"]')).toBeVisible();
  await expect(page.locator('[data-list-state="loading"], [data-list-state="error"]')).toHaveCount(0);
});
