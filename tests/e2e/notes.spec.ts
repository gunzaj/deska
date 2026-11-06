import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// F5: the release notes draft on a Release page. Fixture Release Sprint 23 is e0000023.

test("Release notes: closed issues grouped by Type, not-planned left out, copied as markdown", async ({ browser }) => {
  const { context, page } = await as(browser);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/data", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const res = await route.fetch({ headers });
    const json = await res.json();
    for (const i of json.issues as { n: number; o: number; rl?: string; sr?: string; cl?: string }[]) {
      if (i.n === 100) Object.assign(i, { o: 0, cl: "2026-10-09T10:00:00Z" });
      if (i.n === 101) Object.assign(i, { o: 0, rl: "e0000023", cl: "2026-10-09T10:00:00Z", sr: "not_planned" });
    }
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
  await page.goto("/releases/e0000023");
  const button = page.locator("[data-release-notes-button]");
  await expect(button).toBeVisible();
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Release notes" });
  const text = dialog.locator("[data-notes-text]");
  await expect(text).toContainText("# Release Sprint 23");
  await expect(text).toContainText("Epic: dashboard overhaul");
  await expect(text).not.toContainText("Sub: dashboard widget");
  await expect(text).toContainText("## ");
  await dialog.locator("[data-copy-notes]").click();
  await expect(page.getByText("Release notes copied")).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("[#100]");
  expect(clip.startsWith("# Release Sprint 23")).toBe(true);
  await context.close();
});

test("Release notes: an empty Release says so", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/releases/e0000022");
  await page.locator("[data-release-notes-button]").click();
  await expect(page.locator("[data-notes-text]")).toContainText("Nothing closed in this Release yet");
  await context.close();
});
