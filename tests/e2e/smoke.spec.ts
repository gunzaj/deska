import { expect, test, type Browser } from "@playwright/test";

// Smoke coverage on the fixture dataset (DEMO_DATASET=fixtures) with mocked
// auth via the E2E bypass header. No real OAuth or GitHub calls are made.

async function as(browser: Browser, login = "alice") {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-e2e-login": login } });
  return { context, page: await context.newPage() };
}

test("backlog lists open issues without a release and searches by #number", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog");
  // Both projects show sample data: the preview, or a database seeded with it.
  await expect(page.getByText("Sample data. Titles, numbers, and assignees on this preview are generated in Deska.")).toBeVisible();
  await expect(page.getByText("Sub: dashboard widget")).toBeVisible();
  await expect(page.getByText("Bug: crash on start")).toBeVisible();
  // The epic is planned into Sprint 23, so it is not in the backlog.
  await expect(page.getByText("Epic: dashboard overhaul")).toHaveCount(0);
  await page.getByLabel("Search issues").fill("#101");
  await expect(page.getByText("Bug: crash on start")).toHaveCount(0);
  await expect(page.getByText("Sub: dashboard widget")).toBeVisible();
  await expect(page).toHaveURL(/s=/);
  await context.close();
});

test("filter chips narrow the list and survive a reload", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/issues");
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByRole("option", { name: "Type" }).click();
  await page.getByRole("option", { name: /Bug/ }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Bug: crash on start")).toBeVisible();
  await expect(page.getByText("Epic: dashboard overhaul")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Epic: dashboard overhaul")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Remove Type filter/ })).toBeVisible();
  await context.close();
});

test("issue page shows fields and the parent epic", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/issues/101");
  await expect(page.getByRole("heading", { level: 2, name: "Sub: dashboard widget" })).toBeVisible();
  await expect(page.getByRole("button", { name: /dashboard overhaul/ })).toBeVisible();
  await expect(page.getByText("Sub-issues", { exact: true })).toHaveCount(0);
  await context.close();
});

test("release board renders status columns with counts", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/releases/e0000023");
  await expect(page.getByText("Release Sprint 23")).toBeVisible();
  const todo = page.locator("section", { has: page.getByRole("heading", { name: /To do/ }) });
  await expect(todo.getByRole("heading")).toContainText("1");
  await expect(todo.getByText("Epic: dashboard overhaul")).toBeVisible();
  await context.close();
});

test("saved views are listed in the sidebar and open", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/my");
  await page.getByRole("link", { name: "My tickets by priority" }).click();
  await expect(page.getByRole("heading", { name: /My tickets by priority/ })).toBeVisible();
  await context.close();
});

test("data API requires a session and returns compact rows", async ({ request }) => {
  const anon = await request.get("/api/data", { maxRedirects: 0 });
  expect(anon.status()).toBe(401);
  const res = await request.get("/api/data", { headers: { "x-e2e-login": "alice" } });
  const body = await res.json();
  expect(body.meta.viewer).toBe(""); // the payload is the same for everyone; the browser knows who is signed in
  expect(body.issues.map((i: { n: number }) => i.n).sort()).toEqual([100, 101, 102]);
});

test("edit API is gated when writes are off", async ({ request }) => {
  const res = await request.post("/api/issues/edit", {
    headers: { "x-e2e-login": "alice" },
    data: { issueCount: 1 },
  });
  expect(res.status()).toBe(403);
});

test("the removed server endpoints are gone (SPEC §2.5): no cron sync, reconcile, health or sign-in", async ({ request }) => {
  expect((await request.get("/api/sync-now", { headers: { "x-e2e-login": "alice" } })).status()).toBe(405);
  for (const path of ["/api/reconcile", "/api/health", "/api/auth/signin", "/api/access/recheck", "/signin", "/forbidden"]) {
    expect((await request.get(path, { headers: { "x-e2e-login": "alice" } })).status(), path).toBe(404);
  }
});

test("command palette finds an issue by number and opens it", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/my");
  // Issues load after first paint; the palette mounts with them.
  await expect(page.getByRole("heading", { name: "My issues" })).toBeVisible();
  // The shortcut listener attaches after hydration; retry until the palette opens.
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByLabel("Search commands and issues")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByLabel("Search commands and issues").fill("#102");
  await expect(page.getByRole("option", { name: /Bug: crash on start/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]issue=102/);
  await expect(page.getByRole("complementary", { name: "Issue #102" })).toBeVisible();
  await context.close();
});

test("g then b jumps to the backlog, ? shows shortcuts", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/my");
  await page.getByRole("heading", { name: "My issues" }).click();
  await page.keyboard.press("g");
  await page.keyboard.press("b");
  await expect(page).toHaveURL(/\/backlog$/);
  await page.keyboard.press("Shift+?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await context.close();
});

test("clicking a row opens the side panel with description and comments; Esc closes it", async ({ browser }, testInfo) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog");
  await page.getByText("Sub: dashboard widget").click();
  const panel = page.getByRole("complementary", { name: "Issue #101" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Sub: dashboard widget" })).toBeVisible();
  await expect(panel.getByText("Child")).toBeVisible();
  // Comments come from GitHub; demo data fakes a thread, the Postgres run
  // (no GitHub token) shows the cached description with a note.
  if (testInfo.project.name === "e2e-db") await expect(panel.getByText(/cached description/)).toBeVisible();
  else {
    await expect(panel.getByText("1 comment")).toBeVisible();
    await expect(panel.getByRole("link", { name: "GitHub" })).toHaveCount(0);
    await expect(panel.getByText("Sample issue. The title, description, and assignees are generated for preview.")).toBeVisible();
  }
  await expect(panel.getByRole("button", { name: /Epic: dashboard overhaul|dashboard overhaul/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/issue=/);
  await context.close();
});

test("issue detail API returns the body for a signed-in viewer only", async ({ request }) => {
  expect((await request.get("/api/issues/101", { maxRedirects: 0 })).status()).toBe(401);
  const res = await request.get("/api/issues/101", { headers: { "x-e2e-login": "alice" } });
  const body = await res.json();
  expect(body.number).toBe(101);
  expect(body.bodyHtml).toContain("Child");
});

test("planning pages render: triage queues, releases, epics, insights", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/triage");
  // #102 has neither priority nor team.
  await expect(page.getByText("Bug: crash on start")).toBeVisible();
  await page.getByRole("link", { name: /Not in a release/ }).click();
  await expect(page).toHaveURL(/tab=unplanned/);
  await expect(page.getByText("Sub: dashboard widget")).toBeVisible();

  await page.goto("/releases");
  await expect(page.getByRole("heading", { name: "Release Sprint 23" })).toBeVisible();

  await page.goto("/epics");
  await expect(page.getByText("dashboard overhaul")).toBeVisible();
  await expect(page.getByText("0/1 · 0%")).toBeVisible();

  await page.goto("/insights");
  // One bar list per mapped dimension, named after the field (here "Team").
  await expect(page.getByText("Open issues by Team")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open issues\s*3/ })).toBeVisible();
  await context.close();
});
