import { expect, test } from "@playwright/test";
import { as, done, editRoute, writesOn } from "./helpers";

// W4: bulk edit in the issue list. The fixtures have 3 open issues
// (#100 High, #101 Medium, #102 no priority).

const LOW = "b0000001";

test("select 3, set Priority: 3 requests, rows update", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await editRoute(page, done);
  await page.goto("/issues");
  for (const n of [100, 101, 102]) await page.getByRole("checkbox", { name: `Select #${n}` }).check();
  const bar = page.getByRole("toolbar", { name: "Bulk edit" });
  await expect(bar).toContainText("3 selected");
  await bar.getByRole("button", { name: "Priority" }).click();
  await page.getByRole("option", { name: /Low/ }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: /Set Priority to Low.*: 3 issues done/ })).toBeVisible();
  expect(sent).toHaveLength(3);
  expect(sent.every((s) => s.field === "priority" && s.next === LOW)).toBe(true);
  // The rows show it: open one.
  await page.getByText("Bug: crash on start").click();
  await expect(page.getByRole("complementary", { name: "Issue #102" }).getByRole("button", { name: "Priority: change" })).toContainText("Low");
  await context.close();
});

test("Shift+click selects a range; x toggles the focused row", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  await page.goto("/issues");
  const rows = page.locator("[data-issue]");
  await expect(rows).toHaveCount(3);
  await rows.nth(0).click({ modifiers: ["ControlOrMeta"] });
  await rows.nth(2).click({ modifiers: ["Shift"] });
  const bar = page.getByRole("toolbar", { name: "Bulk edit" });
  await expect(bar).toContainText("3 selected");
  await rows.nth(1).hover();
  await page.keyboard.press("x");
  await expect(bar).toContainText("2 selected");
  await context.close();
});

test("selecting 51 and applying asks first; Cancel sends nothing", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page, { extraIssues: 48 });
  const sent = await editRoute(page, done);
  await page.goto("/issues");
  await expect(page.getByText("51 issues")).toBeVisible();
  await page.getByRole("heading", { name: /Issues|All issues/ }).first().click();
  await page.keyboard.press("ControlOrMeta+a");
  const bar = page.getByRole("toolbar", { name: "Bulk edit" });
  await expect(bar).toContainText("51 selected");
  await bar.getByRole("button", { name: "Priority" }).click();
  await page.getByRole("option", { name: /Low/ }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm bulk edit" });
  await expect(dialog).toContainText(/Set Priority to Low.* on 51 issues\?/);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(sent).toEqual([]);
  await context.close();
});

test("one failure leaves the others applied and lists the failed issue", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  await page.route("**/api/issues/*/edit", (route) =>
    route.request().url().includes("/issues/101/")
      ? route.fulfill({ status: 502, contentType: "application/json", json: { entry: { status: "failed", error: "nope" } } })
      : route.fulfill({ status: 200, contentType: "application/json", json: { entry: { status: "done" } } }),
  );
  await page.goto("/issues");
  for (const n of [100, 101, 102]) await page.getByRole("checkbox", { name: `Select #${n}` }).check();
  await page.getByRole("toolbar", { name: "Bulk edit" }).getByRole("button", { name: "Priority" }).click();
  await page.getByRole("option", { name: /Low/ }).click();
  const toast = page.locator("[data-toast]").filter({ hasText: "2 of 3 done, 1 failed (#101)" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Show failed" }).click();
  await expect(page.locator("[data-issue]")).toHaveCount(1);
  await expect(page.locator('[data-issue="101"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Show all issues again" })).toContainText("Failed edits (1)");
  await context.close();
});
