import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// D11 (SPEC §4.2, §4.3): the new filters in the URL, the default chip, Clear all,
// and the three distinct list states (loading, empty, error).

const url = (state: object) => `/issues?s=${Buffer.from(JSON.stringify({ sort: [], layout: "list", ...state })).toString("base64url")}`;
const rows = (page: Page) => page.locator("[data-row-id]");

test("new filters round-trip through the URL and Clear all removes them", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    const data = await (await page.request.get("/api/data")).json();
    const authors = [...new Set((data.issues as { au: string }[]).map((i) => i.au))];
    const total = (data.issues as unknown[]).length;
    const one = authors[0]!;
    const mine = (data.issues as { au: string }[]).filter((i) => i.au === one).length;

    await page.goto(url({ filters: [{ field: "author", op: "in", values: [one] }] }));
    await expect(rows(page).first()).toBeVisible();
    await expect(rows(page)).toHaveCount(mine);
    await expect(page.getByRole("button", { name: "Remove Author filter" })).toBeVisible();

    // Every new filter is offered in "+ Filter".
    await page.getByRole("button", { name: "Add filter" }).click();
    for (const label of ["Author", "In project", "Closed reason", "Sub-issue progress"]) await expect(page.getByRole("option", { name: new RegExp(`^${label}`) })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^Clear all/ }).click();
    await expect(page.getByRole("button", { name: /^Clear all/ })).toHaveCount(0);
    await expect(rows(page)).toHaveCount(total);
  } finally {
    await context.close();
  }
});

test("empty names the active filters and offers Clear filters", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    await page.goto(url({ filters: [{ field: "author", op: "in", values: ["nobody-here"] }, { field: "inProject", op: "in", values: ["yes"] }] }));
    const empty = page.locator("[data-list-state=empty]");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("No issues match these filters");
    await expect(empty).toContainText("Author includes any of nobody-here");
    await expect(empty).toContainText("In project is Yes");
    await empty.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.locator("[data-list-state]")).toHaveCount(0);
    await expect(rows(page).first()).toBeVisible();
  } finally {
    await context.close();
  }
});

test("an error is not an empty list", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    await page.route("**/api/connection*", (route) => route.fulfill({ json: { state: "invalid", message: "Your GitHub token is invalid or expired", permissions: [], missing: [], readOnly: true } }));
    await page.goto(url({ filters: [{ field: "author", op: "in", values: ["nobody-here"] }] }));
    const error = page.locator("[data-list-state=error]");
    await expect(error).toContainText("Your GitHub token is invalid or expired");
    await expect(page.locator("[data-list-state=empty]")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("while the first import runs an empty cache says so, not 'no issues'", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    await page.route("**/api/data", async (route) => {
      const res = await route.fetch();
      const json = await res.json();
      json.issues = [];
      await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
    });
    await page.route("**/api/sync-status", async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), needsInitialImport: true } });
    });
    await page.goto("/issues");
    const loading = page.locator("[data-list-state=loading]");
    await expect(loading).toContainText("Importing issues from GitHub");
    await expect(page.locator("[data-list-state=empty]")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("the default chip is visible on the list and the walk-through, and removable on the list", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    const data = await (await page.request.get("/api/data")).json();
    const team = data.meta.dimensions[0].options[0] as { id: string; name: string };
    await page.request.patch("/api/me/prefs", { data: { defaultTeam: team.id } });
    await page.goto("/triage?tab=stale");
    const chip = page.locator("[data-team-scope-chip]");
    await expect(chip).toContainText("Default:");
    await chip.click();
    await expect(chip).toContainText("Default off:");
    await chip.click();
    await page.goto("/triage/run?tab=stale");
    await expect(page.locator("[data-team-scope-chip]")).toContainText("Default:");
  } finally {
    await page.request.patch("/api/me/prefs", { data: { defaultTeam: null } });
    await context.close();
  }
});

test("read-only triage mode says why the edit keys do nothing", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    await page.goto("/triage/run?tab=needs");
    await expect(page.locator("[data-triage-issue]")).toBeVisible();
    await expect(page.getByLabel("Triage keys")).toContainText("read-only walk-through");
    for (const key of ["1", "a"]) {
      await page.keyboard.press(key);
      await expect(page.getByRole("status").or(page.getByText(/Editing is off|Read-only token/)).first()).toContainText(/Editing is off|Read-only token/);
    }
  } finally {
    await context.close();
  }
});
