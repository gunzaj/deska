import { expect, test } from "@playwright/test";
import { as, resetSharedSettings } from "./helpers";

// SPEC §4.2: a built-in list keeps the filters and display options the viewer
// saved, so opening it again does not start from the preset. Reset to default
// in the ⋯ menu forgets them.

test.beforeEach(({ request }) => resetSharedSettings(request));
test.afterEach(({ request }) => resetSharedSettings(request));

type Lists = Record<string, { filters?: { field: string; op: string; value?: string }[]; layout?: string }>;

test("My issues opens with the filters and display options the viewer saved", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    await page.goto("/my");
    const search = page.getByLabel("Search issues");
    await search.fill("dashboard");
    await search.press("Enter");
    // The search is a `text` filter in the URL once it is committed.
    await expect(page).toHaveURL(/[?&]s=/);

    await page.getByRole("button", { name: "Display" }).click();
    await page.getByRole("button", { name: "Table", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("table")).toBeVisible();

    // A modified built-in page offers Save, not "Save view": Save keeps this page's defaults.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page).toHaveURL(/\/my$/);

    const { lists } = (await (await page.request.get("/api/me/list-prefs")).json()) as { lists: Lists };
    expect(lists.my?.layout).toBe("table");
    expect(lists.my?.filters).toContainEqual({ field: "text", op: "contains", value: "dashboard" });

    // A full load, not another client-side visit: the server hands the saved defaults to the page.
    await page.reload();
    await expect(page.getByLabel("Search issues")).toHaveValue("dashboard");
    await expect(page.getByRole("table")).toBeVisible();

    // Other pages keep their own defaults; the preset is untouched.
    await page.goto("/issues");
    await expect(page.getByLabel("Search issues")).toHaveValue("");
    const other = (await (await page.request.get("/api/me/list-prefs")).json()) as { lists: Lists };
    expect(other.lists.issues).toBeUndefined();
  } finally {
    await context.close();
  }
});

test("Reset to default forgets a page's saved defaults", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    const state = {
      filters: [{ field: "state", op: "in", values: ["open"] }],
      sort: [{ field: "priority", dir: "desc" }],
      groupBy: "status",
      layout: "table",
    };
    const saved = await page.request.patch("/api/me/list-prefs", { data: { key: "epics", state } });
    expect(saved.status()).toBe(200);

    await page.goto("/epics");
    await expect(page.getByRole("table")).toBeVisible();
    await page.getByRole("button", { name: "List options" }).click();
    await page.getByRole("option", { name: "Reset to default" }).click();

    await expect(page.getByRole("table")).toHaveCount(0);
    const { lists } = (await (await page.request.get("/api/me/list-prefs")).json()) as { lists: Lists };
    expect(lists.epics).toBeUndefined();

    // A reload stays on the factory preset.
    await page.reload();
    await expect(page.getByRole("button", { name: "List options" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
  } finally {
    await context.close();
  }
});
