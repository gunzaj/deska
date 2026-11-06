import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// The user menu: theme and "My team", the default Team filter for lists and Insights.

const reset = (page: Page) => page.request.patch("/api/me/prefs", { data: { defaultTeam: null } });

test("My team filters lists and Insights by default; the chip switches it off; theme lives in the menu", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    const data = await (await page.request.get("/api/data")).json();
    const [team, other] = data.meta.fields.team as { id: string; name: string }[];
    const inTeam = data.issues.filter((i: { o: number; tm?: string }) => i.o === 1 && i.tm === team!.id).length;
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
      await expect(page.getByLabel("My team")).toBeVisible({ timeout: 1500 });
    }).toPass();
    await page.getByLabel("My team").selectOption(team!.id);
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
    await expect(page.getByLabel("Scope")).toHaveValue(`team:${team!.id}`);
    await expect(page.getByRole("link", { name: /^Open issues/ })).toContainText(String(inTeam));
    // Explicitly choosing the whole repo wins over the default.
    await page.getByLabel("Scope").selectOption("");
    await expect(page.getByLabel("Scope")).toHaveValue("");
    await expect(page.getByRole("link", { name: /^Open issues/ })).toContainText(String(allOpen));

    // A page that names a Team itself keeps it.
    const s = Buffer.from(JSON.stringify({ filters: [{ field: "team", op: "in", values: [other!.id] }], sort: [], layout: "list" })).toString("base64url");
    await page.goto(`/issues?s=${s}`);
    await expect(page.locator("[data-team-scope-chip]")).toHaveCount(0);

    // Theme is in the menu now.
    await page.locator("[data-user-menu]").first().click();
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  } finally {
    await reset(page);
    await context.close();
  }
});
