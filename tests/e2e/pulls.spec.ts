import { expect, test, type Browser } from "@playwright/test";

// PR lens (SPEC §13.3) on the fixture PRs: #103 open (review requested from
// bob and team core, which alice is in; closes #102; checks
// failing), #104 merged, #105 draft (review requested from alice).

async function as(browser: Browser, login = "alice") {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-e2e-login": login } });
  return { context, page: await context.newPage() };
}

test("review queue counts team requests; the PR panel shows reviewers, checks and linked issues", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/pulls/review");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: /Review requested\s*1/ })).toBeVisible({ timeout: 20_000 });
  const row = page.getByRole("option").filter({ hasText: "Fix crash" });
  await expect(row).toBeVisible();
  // #105 is a draft, so it isn't waiting on review yet.
  await expect(page.getByRole("option").filter({ hasText: "Draft: dashboard settings" })).toHaveCount(0);
  await row.click();
  const panel = page.getByRole("complementary", { name: "Pull request #103" });
  await expect(panel.getByText("@core")).toBeVisible();
  await expect(panel.getByText("Checks failing")).toBeVisible();
  await expect(panel.getByRole("region", { name: "Linked issues" }).getByText("Bug: crash on start")).toBeVisible();
  await context.close();
});

test("PR explorer: state switch, search and a saved PR view", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/pulls");
  await expect(page.getByRole("option").filter({ hasText: "Fix crash" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("radio", { name: "Merged" }).click();
  await expect(page.getByRole("option").filter({ hasText: "Dashboard widget" })).toBeVisible();
  await expect(page.getByRole("option").filter({ hasText: "Fix crash" })).toHaveCount(0);
  await expect(page).toHaveURL(/s=/);

  await page.getByRole("button", { name: "Save view" }).click();
  const name = `Merged PRs ${Date.now().toString(36)}`;
  const dialog = page.getByRole("dialog", { name: "Save PR view" });
  await dialog.getByLabel("View name").fill(name);
  await dialog.getByRole("button", { name: "Save view" }).click();
  await expect(page).toHaveURL(/\/views\//, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("option").filter({ hasText: "Dashboard widget" })).toBeVisible();
  await context.close();
});

test("an issue shows its linked PR; a PR can be added to tasks and linked by #number", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/issues/102");
  const linked = page.getByRole("region", { name: "Linked PRs" });
  await expect(linked.getByText("Fix crash")).toBeVisible({ timeout: 20_000 });
  await linked.getByRole("button", { name: /Fix crash/ }).click();
  const panel = page.getByRole("complementary", { name: "Pull request #103" });
  await panel.getByRole("region", { name: "Tasks" }).getByRole("button", { name: "Add to tasks" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  const name = `Review the crash fix ${Date.now().toString(36)}`;
  await dialog.getByRole("combobox", { name: "Task" }).pressSequentially(`${name} #105`);
  await expect(dialog.getByLabel("Recognised properties").getByText("#105")).toBeVisible();
  await dialog.getByRole("combobox", { name: "Task" }).press("Enter");
  const task = page.getByRole("complementary", { name: "Task" });
  const links = task.getByRole("region", { name: "Linked issues" });
  await expect(links.getByText("PR #103")).toBeVisible();
  await expect(links.getByText("PR #105")).toBeVisible();
  await context.close();
});
