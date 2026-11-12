import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// Item 3: the Epics view uses the shared Explorer, so the viewer's default team,
// search and the issue filters all narrow epics. The fixtures have one epic; the
// route below adds a second one in the other team so each filter can be observed.

type WireMeta = {
  fields: { status: { id: string }[]; priority: { id: string; name: string }[] };
  dimensions: { id: string; name: string; options: { id: string; name: string }[] }[];
};

/** Pretend the viewer saved `defaultTeam` in the user menu, without touching the shared local prefs. */
async function stubPrefs(page: Page, defaultTeam: string | null) {
  await page.route("**/api/me/prefs", (route) =>
    route.fulfill({ json: { tz: "UTC", browserNotifications: false, sidebar: null, defaultTeam } }),
  );
}

/** Add a second open epic in the Checkout team, with one open and one closed child. */
async function withSecondEpic(page: Page) {
  // Read the real payload before intercepting it, so the field and option IDs are the app's.
  const data = await (await page.request.get("/api/data")).json();
  const meta = data.meta as WireMeta;
  const team = meta.dimensions.find((d) => d.name === "Team")!;
  const core = team.options.find((o) => o.name.includes("Core"))!;
  const checkout = team.options.find((o) => o.name.includes("Checkout"))!;
  const todo = meta.fields.status[0]!.id;
  const medium = meta.fields.priority.find((p) => p.name === "Medium")!.id;

  await page.route("**/api/data", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const res = await route.fetch({ headers });
    const json = await res.json();
    json.issues.push(
      {
        id: "I_epic_checkout",
        n: 104,
        t: "Epic: checkout revamp",
        o: 1,
        au: "bob",
        c: "2026-09-05T00:00:00Z",
        u: "2026-10-05T00:00:00Z",
        st: todo,
        pr: medium,
        dm: { [team.id]: checkout.id },
        lb: ["LA_2"],
        sc: [2, 1],
      },
      { id: "I_epic_checkout_child", n: 105, t: "Sub: checkout flow", o: 1, au: "bob", c: "2026-09-06T00:00:00Z", u: "2026-10-06T00:00:00Z", pa: "I_epic_checkout" },
    );
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
  return { core, checkout };
}

const rows = (page: Page) => page.locator("[data-row-id]");

test("the viewer's default team filters the epics list, and the chip shows and removes it", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    const { core } = await withSecondEpic(page);
    await stubPrefs(page, core.id);

    await page.goto("/epics");
    const chip = page.locator("[data-team-scope-chip]");
    await expect(chip).toContainText("Default: Core");
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText("Epic: dashboard overhaul")).toBeVisible();
    await expect(page.getByText("Epic: checkout revamp")).toHaveCount(0);

    // The chip turns the default off: the other team's epic comes back.
    await chip.click();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText("Epic: checkout revamp")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("search narrows the epics list", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    await withSecondEpic(page);
    await stubPrefs(page, null);

    await page.goto("/epics");
    await expect(rows(page)).toHaveCount(2);

    const search = page.getByLabel("Search issues");
    await search.fill("checkout");
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText("Epic: checkout revamp")).toBeVisible();
    await expect(page.getByText("Epic: dashboard overhaul")).toHaveCount(0);
    await expect(page).toHaveURL(/s=/);

    await search.fill("dashboard");
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText("Epic: dashboard overhaul")).toBeVisible();
    await expect(page.getByText("Epic: checkout revamp")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("a filter narrows epics together with search, and Clear all restores them", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    await withSecondEpic(page);
    await stubPrefs(page, null);

    await page.goto("/epics");
    await expect(rows(page)).toHaveCount(2);
    const search = page.getByLabel("Search issues");

    // Search matches both epics; Priority High keeps only the fixture epic.
    await search.fill("epic");
    await expect(rows(page)).toHaveCount(2);
    await page.getByRole("button", { name: "Add filter" }).click();
    await page.getByRole("option", { name: "Priority" }).click();
    await page.getByRole("option", { name: "High" }).click();
    await page.keyboard.press("Escape");
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByText("Epic: dashboard overhaul")).toBeVisible();
    await expect(page.getByText("Epic: checkout revamp")).toHaveCount(0);

    // Both filters apply: no epic is both High and in the Checkout team.
    await search.fill("checkout");
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator("[data-list-state=empty]")).toContainText("No issues match these filters");
    await expect(page.locator("[data-list-state=empty]")).toContainText("Priority is High");

    // Clear all removes the search and the filter, restoring both epics.
    await page.getByRole("button", { name: /^Clear all/ }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText("Epic: dashboard overhaul")).toBeVisible();
    await expect(page.getByText("Epic: checkout revamp")).toBeVisible();
  } finally {
    await context.close();
  }
});
