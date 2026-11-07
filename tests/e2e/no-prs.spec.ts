import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// D6: pull requests are gone from the UI. No route, no API, no sidebar section,
// no palette entry, and no pull request wording on the main screens.

const PR_TEXT = /pull request|\bPRs?\b/i;

async function openPalette(page: Page) {
  const input = page.getByLabel("Search commands and issues");
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(input).toBeVisible({ timeout: 1000 });
  }).toPass();
  return input;
}

test("no pull request routes or APIs", async ({ browser }) => {
  const { context, page } = await as(browser);
  for (const path of ["/pulls", "/pulls/mine", "/pulls/review"]) expect((await page.request.get(path)).status(), path).toBe(404);
  for (const path of ["/api/prs", "/api/pulls/103"]) expect((await page.request.get(path)).status(), path).toBe(404);
  await context.close();
});

test("no pull request nav, palette entry or text", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/issues");
  await expect(page.getByText("Bug: crash on start")).toBeVisible({ timeout: 20_000 });
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toBeVisible();
  expect(await nav.innerText()).not.toMatch(PR_TEXT);
  expect(await page.locator("body").innerText()).not.toMatch(PR_TEXT);

  const input = await openPalette(page);
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  expect(await dialog.innerText()).not.toMatch(PR_TEXT);
  for (const q of ["pull", "PR", "#103"]) {
    await input.fill(q);
    await expect(dialog.getByRole("option").first()).toBeVisible();
    // The palette echoes the query ("Search all issues for …"); only the results count.
    const text = (await dialog.innerText()).replace(/Search all issues for “[^”]*”/, "");
    expect(text, q).not.toMatch(PR_TEXT);
  }
  await page.keyboard.press("Escape");

  // The pull request the REST issue list carried (#103) never became an issue.
  const data = await (await page.request.get("/api/data")).json();
  expect(data.issues.map((i: { n: number }) => i.n)).not.toContain(103);

  // The issue panel has no linked pull requests section.
  await page.goto("/issues?issue=102");
  const panel = page.getByRole("complementary", { name: "Issue #102" });
  await expect(panel).toBeVisible({ timeout: 20_000 });
  expect(await panel.innerText()).not.toMatch(PR_TEXT);
  await context.close();
});
