import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// Settings → Local data (D8) against the database-backed e2e server. The final
// "Yes, reset everything" is never clicked here: the server's database is
// shared with the other specs (the route itself is covered by Vitest).

test("Reset everything asks twice, and Cancel changes nothing", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Local data" })).toBeVisible();

  await page.getByRole("button", { name: "Reset everything…" }).click();
  await expect(page.getByText("This deletes every task, project, label, saved view, snooze and watch on this Mac.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Last chance. Reset everything now?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Reset everything…" })).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Inbox" }).first()).toBeVisible();
  await context.close();
});

test("Export downloads a JSON file and Import merges it without adding duplicates", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/settings");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^deska-export-\d{4}-\d{2}-\d{2}\.json$/);

  const res = await page.request.get("/api/local-data/export");
  const buffer = Buffer.from(await res.body());
  await page.locator('input[type="file"]').setInputFiles({ name: "export.json", mimeType: "application/json", buffer });
  await expect(page.getByRole("status").filter({ hasText: "Imported 0 new rows" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("not json") });
  await expect(page.getByRole("alert").filter({ hasText: "not valid JSON" })).toBeVisible();
  await context.close();
});
