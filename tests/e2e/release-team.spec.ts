import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// IMPROVEMENTS 4: the viewer's default Team scopes a Release page's overview
// (header, Risk and notes) and its lower issue list alike. Fixture Release
// "Sprint 23" is e0000023; the payload is bent so it holds two teams.

const CURRENT = "e0000023";

type WireIssue = {
  id: string;
  n: number;
  t: string;
  o: 0 | 1;
  sr?: string;
  pr?: string;
  dm?: Record<string, string>;
  rl?: string;
  ty?: string;
  as?: string[];
  au: string;
  c: string;
  u: string;
  cl?: string;
};

type WireData = {
  meta: {
    dimensions: { id: string; options: { id: string; name: string }[] }[];
    fields: { priority: { id: string }[] };
    issueTypes: { id: string }[];
  };
  issues: WireIssue[];
};

/** A list, so every row in the release is countable. */
const state = Buffer.from(JSON.stringify({ filters: [], sort: [{ field: "updated", dir: "desc" }], layout: "list", groupBy: "sprintState" })).toString("base64url");
const release = `/releases/${CURRENT}?s=${state}`;

/**
 * Core holds #100 and #105 closed and #102 and #106 open; Checkout holds #101
 * closed and #104 open. #102, #104 and #106 are open top-priority issues with
 * nobody assigned, so Risk has two Core rows and one Checkout row.
 */
async function bend(page: Page) {
  await page.route("**/api/data", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const res = await route.fetch({ headers });
    const json = (await res.json()) as WireData;
    const dim = json.meta.dimensions[0]!;
    const [core, checkout] = dim.options;
    const high = json.meta.fields.priority.at(-1)!.id;
    const type = json.meta.issueTypes[0]!.id;
    for (const i of json.issues) {
      delete i.rl;
      delete i.sr;
      delete i.cl;
      delete i.pr;
      delete i.as;
      delete i.dm;
    }
    const put = (n: number, over: Partial<WireIssue>) => {
      const i = json.issues.find((x) => x.n === n);
      if (i) Object.assign(i, over);
    };
    put(100, { rl: CURRENT, o: 0, cl: "2026-10-09T10:00:00Z", sr: "completed", pr: high, ty: type, as: ["alice"], dm: { [dim.id]: core!.id } });
    put(101, { rl: CURRENT, o: 0, cl: "2026-10-09T10:00:00Z", sr: "completed", pr: high, ty: type, as: ["bob"], dm: { [dim.id]: checkout!.id } });
    put(102, { rl: CURRENT, o: 1, pr: high, ty: type, as: [], dm: { [dim.id]: core!.id } });
    for (const [n, team, over] of [
      [104, checkout!, { o: 1 as const }],
      [105, core!, { o: 0 as const, cl: "2026-10-09T10:00:00Z", sr: "completed" }],
      [106, core!, { o: 1 as const }],
    ] as const) {
      json.issues.push({
        id: `I_release${n}`,
        n,
        t: `Release team issue ${n}`,
        au: "alice",
        c: "2026-09-01T00:00:00Z",
        u: "2026-10-09T00:00:00Z",
        rl: CURRENT,
        pr: high,
        ty: type,
        as: [],
        dm: { [dim.id]: team.id },
        ...over,
      });
    }
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
  await page.route(`**/api/releases/${CURRENT}/scope-added*`, (route) => route.fulfill({ json: { since: "x", nodeIds: [] } }));
}

async function expectNumbers(page: Page, want: { rows: number; done: string; remaining: string; risk: string; notes: number; filtered?: string }) {
  await expect(page.locator("[data-row-id]")).toHaveCount(want.rows);
  await expect(page.locator("[data-sprint-done]")).toContainText(want.done);
  await expect(page.locator("[data-sprint-remaining]")).toHaveText(want.remaining);
  await expect(page.locator('[data-risk="no-owner"] [data-risk-count]')).toHaveText(want.risk);
  if (want.filtered) await expect(page.locator("[data-sprint-filtered]")).toContainText(want.filtered);
  else await expect(page.locator("[data-sprint-filtered]")).toHaveCount(0);
  await page.locator("[data-release-notes-button]").click();
  const dialog = page.getByRole("dialog", { name: "Release notes" });
  await expect(dialog).toContainText(`${want.notes} issue${want.notes === 1 ? "" : "s"} closed`);
  await page.keyboard.press("Escape");
}

test("the default Team scopes the Release overview and list; changing it and turning it off updates both", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    await bend(page);
    const data = (await (await page.request.get("/api/data")).json()) as WireData;
    const [core, checkout] = data.meta.dimensions[0]!.options;

    // No default: the overview and the list both show every team.
    await page.request.patch("/api/me/prefs", { data: { defaultTeam: null } });
    await page.goto(release);
    await expect(page.locator("[data-team-scope-chip]")).toHaveCount(0);
    await expectNumbers(page, { rows: 6, done: "3 / 6", remaining: "3", risk: "3", notes: 3 });
    await page.locator("[data-release-notes-button]").click();
    await expect(page.locator("[data-notes-text]")).toContainText("#105");
    await page.keyboard.press("Escape");

    // Core: both follow the default.
    const menu = page.locator("[data-user-menu]").first();
    await menu.click();
    await expect(page.getByLabel("My default")).toBeVisible();
    await page.getByLabel("My default").selectOption(core!.id);
    await expect.poll(async () => (await (await page.request.get("/api/me/prefs")).json()).defaultTeam).toBe(core!.id);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-team-scope-chip]")).toContainText("Core");
    await expectNumbers(page, { rows: 4, done: "2 / 4", remaining: "2", risk: "2", notes: 2, filtered: "4 / 4" });
    await page.locator("[data-release-notes-button]").click();
    const coreNotes = page.locator("[data-notes-text]");
    await expect(coreNotes).toContainText("#100");
    await expect(coreNotes).toContainText("#105");
    await expect(coreNotes).not.toContainText("#101");
    await page.keyboard.press("Escape");

    // Changing the default team updates both sections.
    await menu.click();
    await page.getByLabel("My default").selectOption(checkout!.id);
    await expect.poll(async () => (await (await page.request.get("/api/me/prefs")).json()).defaultTeam).toBe(checkout!.id);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-team-scope-chip]")).toContainText("Checkout");
    await expectNumbers(page, { rows: 2, done: "1 / 2", remaining: "1", risk: "1", notes: 1, filtered: "2 / 2" });
    await page.locator("[data-release-notes-button]").click();
    const checkoutNotes = page.locator("[data-notes-text]");
    await expect(checkoutNotes).toContainText("#101");
    await expect(checkoutNotes).not.toContainText("#100");
    await page.keyboard.press("Escape");

    // The chip turns the default off: both go back to every team.
    const chip = page.locator("[data-team-scope-chip]");
    await chip.click();
    await expect(chip).toContainText("Default off:");
    await expectNumbers(page, { rows: 6, done: "3 / 6", remaining: "3", risk: "3", notes: 3 });

    // Clearing the default keeps both on every team.
    await menu.click();
    await page.getByLabel("My default").selectOption("");
    await expect.poll(async () => (await (await page.request.get("/api/me/prefs")).json()).defaultTeam).toBeNull();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-team-scope-chip]")).toHaveCount(0);
    await expectNumbers(page, { rows: 6, done: "3 / 6", remaining: "3", risk: "3", notes: 3 });
  } finally {
    await page.request.patch("/api/me/prefs", { data: { defaultTeam: null } });
    await context.close();
  }
});
