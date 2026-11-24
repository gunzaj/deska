import { expect, test, type Page } from "@playwright/test";
import { as, done, editRoute, writesOn } from "./helpers";

// Relationships in the issue panel (parent, blocked by, blocking, relates
// to), one section with one menu, as on GitHub. The e2e server runs with writes off, so these tests turn them on in
// /api/data and answer the edit and relationships routes themselves: nothing
// is ever written to GitHub.

async function openBug(page: Page) {
  await page.goto("/backlog");
  await page.getByText("Bug: crash on start").click();
  const panel = page.getByRole("complementary", { name: "Issue #102" });
  await expect(panel).toBeVisible();
  return panel;
}

const SEARCH = "Search by title or #number…";
const EPIC = { nodeId: "I_epic", number: 100, title: "Epic", state: "open", stateReason: null, url: "https://github.com/acme/widgets/issues/100", repo: "acme/widgets" };

/** Answer /relationships for #102 from `lists` (mutable by the test). */
async function relationsRoute(page: Page, lists: { blockedBy: unknown[]; blocking: unknown[]; relatesTo: unknown[] }) {
  await page.route("**/api/issues/102/relationships", (route) => route.fulfill({ json: { ...lists, cached: false } }));
}

test("one Relationships section, one menu with GitHub's four options and their keys", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  await relationsRoute(page, { blockedBy: [], blocking: [], relatesTo: [] });
  const panel = await openBug(page);
  const rel = panel.getByRole("region", { name: "Relationships" });
  await expect(rel).toContainText("None yet");
  await rel.getByRole("button", { name: "Edit relationships" }).click();
  const options = page.getByRole("option");
  await expect(options).toHaveText([/Add parent\s*⌥⇧P/, /Mark as blocked by\s*BB/, /Mark as blocking\s*BX/, /Add relates to\s*BR/]);
  await context.close();
});

test("add a parent from the menu: the edit carries the old parent as base, and the section shows it", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  await relationsRoute(page, { blockedBy: [], blocking: [], relatesTo: [] });
  const sent = await editRoute(page, done);
  const panel = await openBug(page);
  const rel = panel.getByRole("region", { name: "Relationships" });
  await rel.getByRole("button", { name: "Edit relationships" }).click();
  await page.getByRole("option", { name: /Add parent/ }).click();
  await page.getByPlaceholder(SEARCH).fill("#100");
  await page.getByRole("option", { name: /#100/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ field: "parent", base: null, next: "I_epic" });
  await expect(rel.locator("[data-relation='parent'] [data-related='100']")).toBeVisible();
  await expect(rel).toContainText("Parent issue");
  await context.close();
});

test("⌥⇧P opens the parent search for the open issue", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  await relationsRoute(page, { blockedBy: [], blocking: [], relatesTo: [] });
  const sent = await editRoute(page, done);
  await openBug(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Alt+Shift+KeyP");
  await page.getByPlaceholder(SEARCH).fill("100");
  await page.getByRole("option", { name: /#100/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ field: "parent", next: "I_epic" });
  await context.close();
});

for (const [mode, keys, heading] of [
  ["blockedBy", "b b", "Blocked by"],
  ["blocking", "b x", "Blocking"],
  ["relatesTo", "b r", "Relates to"],
] as const) {
  test(`${heading}: the ${keys.toUpperCase()} keys link an issue, ✕ unlinks it, both as deltas`, async ({ browser }) => {
    const { context, page } = await as(browser);
    await writesOn(page);
    const lists = { blockedBy: [] as unknown[], blocking: [] as unknown[], relatesTo: [] as unknown[] };
    await relationsRoute(page, lists);
    const sent = await editRoute(page, (body) => {
      lists[mode] = (body.next as { added: string[] }).added.length ? [EPIC] : [];
      return done(body);
    });
    const panel = await openBug(page);
    const rel = panel.getByRole("region", { name: "Relationships" });
    await expect(rel).toContainText("None yet");
    // Keys outside any text field (opening the panel may focus one).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const k of keys.split(" ")) await page.keyboard.press(k);
    await page.getByPlaceholder(SEARCH).fill("100");
    await page.getByRole("option", { name: /#100/ }).click();
    await expect(rel.locator(`[data-relation='${mode}'] [data-related='100']`)).toBeVisible();
    await expect(rel).toContainText(heading);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual(expect.objectContaining({ field: mode, next: { added: ["I_epic"], removed: [] } }));
    expect(sent[0]).not.toHaveProperty("base");
    await rel.getByRole("button", { name: new RegExp(`Remove ${heading.toLowerCase()} #100`, "i") }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toMatchObject({ field: mode, next: { added: [], removed: ["I_epic"] } });
    await expect(rel.locator("[data-related='100']")).toHaveCount(0);
    await context.close();
  });
}

test("with writes off, the menu button says why and opens nothing", async ({ browser }) => {
  const { context, page } = await as(browser);
  const panel = await openBug(page);
  const edit = panel.getByRole("region", { name: "Relationships" }).getByRole("button", { name: "Edit relationships" });
  await expect(edit).toHaveAttribute("aria-disabled", "true");
  await edit.click({ force: true });
  await expect(page.getByRole("option", { name: /Mark as blocked by/ })).toHaveCount(0);
  await context.close();
});

test("sub-issues: add an existing issue and remove one, as deltas on the parent", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await editRoute(page, done);
  await page.goto("/backlog?issue=100");
  const subs = page.getByRole("region", { name: "Sub-issues" });
  await expect(subs.locator("[data-sub-issue='101']")).toBeVisible();
  await subs.getByRole("button", { name: "Add sub-issue" }).click();
  await page.getByPlaceholder("Search by title or #number…").fill("#102");
  await page.getByRole("option", { name: /#102/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ field: "subIssues", next: { added: ["I_bug"], removed: [] } });
  await subs.getByRole("button", { name: "Remove sub-issue #101" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ field: "subIssues", next: { added: [], removed: ["I_sub"] } });
  await context.close();
});
