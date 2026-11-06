import { expect, test, type Page } from "@playwright/test";
import { as, done, editRoute, writesOn } from "./helpers";

// W3: drag cards between board columns and from the Backlog drawer into a
// Release. Fixture Release Sprint 23 holds the epic (#100, Status "To do").

const TODO = "a0000001";
const IN_PROGRESS = "a0000002";
const RELEASE = "e0000023";

const column = (page: Page, name: RegExp) => page.locator("section[data-column]").filter({ has: page.getByRole("heading", { name }) });
const card = (page: Page, title: string) => page.locator("[data-issue]").filter({ hasText: title });

/** A real pointer drag: dnd-kit needs a few pixels of travel before it starts. */
async function drag(page: Page, from: ReturnType<Page["locator"]>, to: ReturnType<Page["locator"]>) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 10 });
  await page.mouse.up();
}

test("drag a card to another column: it moves at once; the request has the field and option ID", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const sent = await editRoute(page, async (body) => {
    await gate;
    return done(body);
  });
  await page.goto(`/releases/${RELEASE}`);
  const epic = card(page, "Epic: dashboard overhaul");
  await expect(column(page, /To do/).locator(epic)).toBeVisible();
  await drag(page, epic, column(page, /In progress/));
  // Moved before the server answered.
  await expect(column(page, /In progress/).locator(card(page, "Epic: dashboard overhaul"))).toBeVisible();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ field: "status", base: TODO, next: IN_PROGRESS });
  release();
  await expect(column(page, /In progress/).locator(card(page, "Epic: dashboard overhaul"))).toBeVisible();
  await context.close();
});

test("keyboard: Space picks up, → moves a column, Space drops", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await editRoute(page, done);
  await page.goto(`/releases/${RELEASE}`);
  const epic = card(page, "Epic: dashboard overhaul");
  await epic.focus();
  await page.keyboard.press("Space");
  // Picked up (dnd-kit marks the active card pressed) before moving it.
  await expect(epic).toHaveAttribute("aria-pressed", "true");
  // dnd-kit measures the columns just after pickup; an arrow pressed before
  // that is ignored. Press until the jump lands (it moves one column at most).
  const target = column(page, /In progress/);
  await expect(async () => {
    if ((await target.getAttribute("data-over")) !== "true") await page.keyboard.press("ArrowRight");
    await expect(target).toHaveAttribute("data-over", "true", { timeout: 400 });
  }).toPass({ timeout: 5000 });
  await page.keyboard.press("Space");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ field: "status", base: TODO, next: IN_PROGRESS });
  await expect(column(page, /In progress/).locator(card(page, "Epic: dashboard overhaul"))).toBeVisible();
  await context.close();
});

test("a failed move snaps the card back with a toast", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  await editRoute(page, () => ({ status: 502, json: { entry: { status: "failed", error: "GitHub is down" } } }));
  await page.goto(`/releases/${RELEASE}`);
  await drag(page, card(page, "Epic: dashboard overhaul"), column(page, /In progress/));
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn't save: GitHub is down" })).toBeVisible();
  await expect(column(page, /To do/).locator(card(page, "Epic: dashboard overhaul"))).toBeVisible();
  await context.close();
});

test("Move to… in the card's context menu", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await editRoute(page, done);
  await page.goto(`/releases/${RELEASE}`);
  await card(page, "Epic: dashboard overhaul").click({ button: "right" });
  await page.getByRole("option", { name: /In progress/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ field: "status", next: IN_PROGRESS });
  await context.close();
});

test("drag from the Backlog drawer into the Release board sets the Release", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await editRoute(page, done);
  await page.goto(`/releases/${RELEASE}`);
  await page.getByRole("button", { name: /Backlog/ }).click();
  const drawer = page.getByRole("region", { name: "Backlog" });
  const bug = drawer.locator("[data-issue]").filter({ hasText: "Bug: crash on start" });
  await expect(bug).toBeVisible();
  await drag(page, bug, column(page, /To do/));
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ field: "release", base: null, next: RELEASE });
  await context.close();
});

test("with writes off cards don't drag but still open on click", async ({ browser }) => {
  const { context, page } = await as(browser);
  const sent = await editRoute(page, done);
  await page.goto(`/releases/${RELEASE}`);
  await expect(page.getByRole("button", { name: /Backlog/ })).toHaveCount(0);
  const epic = card(page, "Epic: dashboard overhaul");
  await drag(page, epic, column(page, /In progress/));
  await expect(column(page, /To do/).locator(card(page, "Epic: dashboard overhaul"))).toBeVisible();
  await card(page, "Epic: dashboard overhaul").click();
  await expect(page.getByRole("complementary", { name: "Issue #100" })).toBeVisible();
  expect(sent).toEqual([]);
  await context.close();
});
