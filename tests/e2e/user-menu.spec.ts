import { expect, test, type Page } from "@playwright/test";
import { as, resetSharedSettings } from "./helpers";

// Shared server settings start and end at their defaults (issue #6).
test.beforeEach(({ request }) => resetSharedSettings(request));
test.afterEach(({ request }) => resetSharedSettings(request));

// The user menu: theme and "My default", a default value of a mapped dimension
// (here the fixtures' Team field) that lists and Insights filter by (§4.1, §4.2).

const reset = (page: Page) => page.request.patch("/api/me/prefs", { data: { defaultTeam: null } });

test("My default filters lists and Insights by default; the chip switches it off; theme lives in the menu", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    const data = await (await page.request.get("/api/data")).json();
    const dim = data.meta.dimensions[0] as { id: string; key: string; options: { id: string; name: string }[] };
    const [team, other] = dim.options;
    const inTeam = data.issues.filter((i: { o: number; dm?: Record<string, string> }) => i.o === 1 && i.dm?.[dim.id] === team!.id).length;
    const allOpen = data.issues.filter((i: { o: number }) => i.o === 1).length;
    expect(inTeam).toBeGreaterThan(0);
    expect(inTeam).toBeLessThan(allOpen);

    await page.goto("/issues");
    const rows = page.locator("[data-row-id]");
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    await expect(page.locator("[data-team-scope-chip]")).toHaveCount(0);

    // Open the menu, pick the team.
    const menu = page.locator("[data-user-menu]").first();
    await expect(async () => {
      await menu.click();
      await expect(page.getByLabel("My default")).toBeVisible({ timeout: 1500 });
    }).toPass();
    await page.getByLabel("My default").selectOption(team!.id);
    await expect.poll(async () => (await (await page.request.get("/api/me/prefs")).json()).defaultTeam).toBe(team!.id);
    await page.keyboard.press("Escape");

    // The list is filtered, with a chip to turn it off.
    await expect(page.locator("[data-team-scope-chip]")).toBeVisible();
    await expect.poll(() => rows.count()).toBeLessThanOrEqual(before);
    await expect.poll(() => rows.count()).toBe(inTeam);
    await page.locator("[data-team-scope-chip]").click();
    await expect.poll(() => rows.count()).toBe(before);
    await page.locator("[data-team-scope-chip]").click();

    // It survives a reload and applies to Insights.
    await page.goto("/insights");
    await expect(page.getByLabel("Scope")).toHaveValue(`dim:${dim.id}:${team!.id}`);
    await expect(page.getByRole("link", { name: /^Open issues/ })).toContainText(String(inTeam));
    // Explicitly choosing the whole repo wins over the default.
    await page.getByLabel("Scope").selectOption("");
    await expect(page.getByLabel("Scope")).toHaveValue("");
    await expect(page.getByRole("link", { name: /^Open issues/ })).toContainText(String(allOpen));

    // A page that filters that dimension itself keeps its own filter.
    const s = Buffer.from(JSON.stringify({ filters: [{ field: dim.key, op: "in", values: [other!.id] }], sort: [], layout: "list" })).toString("base64url");
    await page.goto(`/issues?s=${s}`);
    await expect(page.locator("[data-team-scope-chip]")).toHaveCount(0);

    // Theme is in the menu now.
    await page.locator("[data-user-menu]").first().click();
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/settings/theme") && r.request().method() === "POST");
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // Stored in the app's settings (ADR-001), not localStorage: a fresh load renders it from the server.
    expect((await saved).status()).toBe(200);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator("[data-user-menu]").first().click();
    const back = page.waitForResponse((r) => r.url().endsWith("/api/settings/theme") && r.request().method() === "POST");
    await page.getByRole("radio", { name: "System" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
    await back;
  } finally {
    await reset(page);
    await context.close();
  }
});
