import { expect, test, type Page } from "@playwright/test";
import { as, done, editRoute, writesOn, type Sent } from "./helpers";

// W2: editing in the issue panel. The e2e server runs with writes off, so
// these tests turn them on in the /api/data payload and answer the edit route
// themselves: nothing is ever written to GitHub.

const HIGH = "b0000003";
const LOW = "b0000001";

async function openBug(page: Page) {
  await page.goto("/backlog");
  await page.getByText("Bug: crash on start").click();
  const panel = page.getByRole("complementary", { name: "Issue #102" });
  await expect(panel).toBeVisible();
  return panel;
}


test("set Priority: the row moves group at once, and success keeps it", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const sent: Sent[] = [];
  await page.route("**/api/issues/*/edit", async (route) => {
    sent.push(route.request().postDataJSON());
    await gate;
    await route.fulfill({ status: 200, contentType: "application/json", json: { entry: { id: "e", status: "done" } } });
  });
  const panel = await openBug(page);
  await panel.getByRole("button", { name: "Priority: change" }).click();
  await page.getByRole("option", { name: /High/ }).click();
  // Before the server answers, the backlog already groups #102 under High.
  await expect(page.locator("main").getByText(/High/).first()).toBeVisible();
  await expect(page.locator("main").getByText("No priority")).toHaveCount(0);
  release();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ field: "priority", base: null, next: HIGH });
  await expect(page.locator("main").getByText(/High/).first()).toBeVisible();
  await context.close();
});

test("a failed write reverts and shows a toast", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  await editRoute(page, () => ({ status: 502, json: { entry: { status: "failed", error: "GitHub said no" } } }));
  const panel = await openBug(page);
  await panel.getByRole("button", { name: "Priority: change" }).click();
  await page.getByRole("option", { name: /High/ }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn't save: GitHub said no" })).toBeVisible();
  await expect(page.locator("main").getByText("No priority")).toBeVisible();
  await context.close();
});

test("conflict: Keep theirs shows GitHub's value; Overwrite resends with the new base", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const MEDIUM = "b0000002";
  const sent = await editRoute(page, (body, n) =>
    n === 1
      ? { status: 409, json: { entry: { status: "conflict", remote: LOW, error: "Changed on GitHub" } } }
      : n === 2
        ? { status: 409, json: { entry: { status: "conflict", remote: MEDIUM, error: "Changed on GitHub" } } }
        : done(body),
  );
  const panel = await openBug(page);
  await panel.getByRole("button", { name: "Priority: change" }).click();
  await page.getByRole("option", { name: /High/ }).click();
  const dialog = page.getByRole("dialog", { name: "Edit conflict" });
  await expect(dialog.getByText("Changed on GitHub by someone")).toBeVisible();
  await expect(dialog.getByTestId("conflict-theirs")).toHaveText(/Low/);
  await expect(dialog.getByTestId("conflict-yours")).toHaveText(/High/);
  await dialog.getByRole("button", { name: "Keep theirs" }).click();
  await expect(panel.getByRole("button", { name: "Priority: change" })).toContainText(/Low/);

  // Again (someone changed it once more), this time overwriting.
  await panel.getByRole("button", { name: "Priority: change" }).click();
  await page.getByRole("option", { name: /High/ }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ base: LOW, next: HIGH });
  await page.getByRole("dialog", { name: "Edit conflict" }).getByRole("button", { name: "Overwrite" }).click();
  await expect.poll(() => sent.length).toBe(3);
  expect(sent[2]).toMatchObject({ field: "priority", base: MEDIUM, next: HIGH });
  await expect(panel.getByRole("button", { name: "Priority: change" })).toContainText(/High/);
  await context.close();
});

test("labels are added and removed as deltas, never the full set", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await editRoute(page, done);
  const panel = await openBug(page);
  await panel.getByRole("button", { name: "Labels: change" }).click();
  await page.getByRole("option", { name: "UI" }).click();
  await expect.poll(() => sent.length).toBe(1);
  await page.getByRole("option", { name: "UI" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent).toEqual([
    expect.objectContaining({ field: "labels", next: { added: ["LA_1"], removed: [] } }),
    expect.objectContaining({ field: "labels", next: { added: [], removed: ["LA_1"] } }),
  ]);
  expect(sent.every((s) => !("base" in s))).toBe(true);
  await context.close();
});

test("with writes off every picker is disabled with the tooltip and nothing is sent", async ({ browser }) => {
  const { context, page } = await as(browser);
  const sent = await editRoute(page, done);
  const panel = await openBug(page);
  const pickers = panel.getByRole("button", { name: /: change$/ });
  // Status, Priority, Assignees, Release, the one mapped dimension (Team), Type, Milestone, Labels.
  await expect(pickers).toHaveCount(8);
  for (const b of await pickers.all()) {
    await expect(b).toHaveAttribute("aria-disabled", "true");
    await expect(b).toHaveAttribute("title", "Editing is off for this deployment");
  }
  // aria-disabled, not disabled: still focusable for the tooltip, so force the click.
  await pickers.first().click({ force: true });
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /Close issue/ })).toHaveAttribute("title", "Editing is off for this deployment");
  await panel.getByRole("button", { name: /Close issue/ }).click({ force: true });
  expect(sent).toEqual([]);
  await context.close();
});
