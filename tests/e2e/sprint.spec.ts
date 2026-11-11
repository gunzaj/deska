import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// D10: the sprint view (§4.5). Fixture Release "Sprint 23" (e0000023) is current,
// Sprint 22 (e0000022) the one before. The payload is bent per test.

const CURRENT = "e0000023";
const PREVIOUS = "e0000022";

type Json = {
  meta: { mapping: { sprint: unknown; doneStatusIds: string[] }; fields: { status: { id: string }[] }; writeMode: boolean };
  issues: { id: string; n: number; o: 0 | 1; sr?: string; st?: string; rl?: string; cl?: string }[];
};

async function bend(page: Page, fn: (json: Json) => void) {
  await page.route("**/api/data", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const res = await route.fetch({ headers });
    const json = (await res.json()) as Json;
    fn(json);
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
  await page.route("**/api/releases/*/scope-added*", (route) => route.fulfill({ json: { since: "x", nodeIds: [] } }));
}

/** The current sprint holds 2 open, 2 closed as completed and 1 closed as not planned. */
function shape(json: Json) {
  const mine = json.issues.filter((i) => i.rl === CURRENT);
  // Pad with copies so there are always five.
  while (mine.length < 5) {
    const n = 5000 + mine.length;
    const extra = { id: `I_sprint${n}`, n, t: `Sprint filler ${n}`, o: 1 as const, rl: CURRENT, au: "alice", c: "2026-09-01T00:00:00Z", u: "2026-09-01T00:00:00Z" };
    json.issues.push(extra as never);
    mine.push(extra as never);
  }
  mine.forEach((i, k) => {
    delete i.sr;
    delete i.cl;
    delete i.st;
    if (k < 2) i.o = 1;
    else {
      i.o = 0;
      i.cl = "2026-10-10T00:00:00Z";
      if (k === 4) i.sr = "not_planned";
    }
  });
  // Anything beyond five is moved out so the numbers are known.
  for (const i of mine.slice(5)) i.rl = PREVIOUS;
  return mine.slice(0, 5);
}

test("the header counts Remaining, Done and Not planned and leaves not planned out of the percentage", async ({ browser }) => {
  const { context, page } = await as(browser);
  await bend(page, (json) => void shape(json));
  await page.goto(`/releases/${CURRENT}`);
  const header = page.locator("[data-sprint-header]");
  await expect(header.locator("[data-sprint-done]")).toContainText("2 / 4");
  await expect(header.locator("[data-sprint-done]")).toContainText("50%");
  await expect(header.locator("[data-sprint-remaining]")).toHaveText("2");
  await expect(header.locator("[data-sprint-not-planned]")).toHaveText("1");
  await expect(header.locator("[data-sprint-when]")).toContainText("left");
  await context.close();
});

test("Status options marked as done count as done", async ({ browser }) => {
  const { context, page } = await as(browser);
  await bend(page, (json) => {
    const mine = shape(json);
    const doneStatus = json.meta.fields.status[0]!.id;
    mine[0]!.st = doneStatus;
    json.meta.mapping.doneStatusIds = [doneStatus];
  });
  await page.goto(`/releases/${CURRENT}`);
  await expect(page.locator("[data-sprint-done]")).toContainText("3 / 4");
  await expect(page.locator("[data-sprint-remaining]")).toHaveText("1");
  await context.close();
});

test("a filter makes the header say it is filtered and shows the filtered numbers", async ({ browser }) => {
  const { context, page } = await as(browser);
  await bend(page, (json) => void shape(json));
  await page.goto(`/releases/${CURRENT}`);
  await expect(page.locator("[data-sprint-filtered]")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search issues" }).fill("Sprint filler");
  const note = page.locator("[data-sprint-filtered]");
  await expect(note).toBeVisible();
  await expect(note).toContainText("(filtered)");
  await expect(note).toContainText("/ 5");
  await context.close();
});

test("[ and ] step to the previous and next sprint", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto(`/releases/${CURRENT}`);
  await expect(page.getByRole("button", { name: "Next sprint" })).toBeDisabled();
  await page.keyboard.press("[");
  await expect(page).toHaveURL(new RegExp(`/releases/${PREVIOUS}$`));
  await page.keyboard.press("]");
  await expect(page).toHaveURL(new RegExp(`/releases/${CURRENT}$`));
  await context.close();
});

test("the list groups into Remaining, Done and a collapsed Not planned", async ({ browser }) => {
  const { context, page } = await as(browser);
  await bend(page, (json) => void shape(json));
  const state = Buffer.from(JSON.stringify({ filters: [], sort: [{ field: "updated", dir: "desc" }], layout: "list", groupBy: "sprintState" })).toString("base64url");
  await page.goto(`/releases/${CURRENT}?s=${state}`);
  await expect(page.getByRole("button", { name: /Remaining/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Done/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Not planned/ })).toHaveAttribute("aria-expanded", "false");
  await context.close();
});

test("an empty sprint, an unreadable project and a missing Sprint field each have their own message", async ({ browser }) => {
  const { context, page } = await as(browser);
  // Empty: nothing in the sprint, GitHub reachable.
  await bend(page, (json) => {
    for (const i of json.issues) if (i.rl === CURRENT) i.rl = PREVIOUS;
  });
  await page.goto(`/releases/${CURRENT}`);
  await expect(page.getByText("Nothing planned in this sprint yet")).toBeVisible();
  await expect(page.locator("[data-sprint-unreadable]")).toHaveCount(0);

  // Unreadable: the same empty sprint while the token is refused.
  await page.route("**/api/connection*", (route) =>
    route.fulfill({
      json: { state: "missing-permission", message: "The token is missing a permission: Organization → Projects: Read", login: "alice", name: null, avatarUrl: null, expiresAt: null, expiryWarning: null, readOnly: true, readOnlyMessage: "Read-only token", permissions: [], missing: ["Organization → Projects: Read"], rateLimitedUntil: null, checkedAt: "2026-11-06T09:00:00.000Z" },
    }),
  );
  await page.goto(`/releases/${CURRENT}`);
  await expect(page.locator("[data-sprint-unreadable]")).toContainText("missing a permission");
  await expect(page.getByText("Nothing planned in this sprint yet")).toHaveCount(0);

  // No Sprint field mapped.
  await page.unroute("**/api/data");
  await bend(page, (json) => {
    json.meta.mapping.sprint = null;
  });
  await page.goto(`/releases/${CURRENT}`);
  await expect(page.locator("[data-no-sprint]")).toContainText("No Sprint field mapped");
  await context.close();
});

test("planning controls are visible, disabled and say why while writes are off", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto(`/releases/${CURRENT}`);
  const bulk = page.getByRole("button", { name: /Bulk edit/ });
  await expect(bulk).toBeVisible();
  await expect(bulk).toBeDisabled();
  await expect(bulk).toContainText(/Editing is off|Read-only token/);
  await page.goto("/releases/plan");
  const move = page.locator("[data-planning-disabled]").first();
  if (await move.count()) {
    await expect(move).toBeDisabled();
    await expect(page.locator("[data-plan-off-reason]")).toContainText(/Editing is off|Read-only token/);
  }
  await context.close();
});

test("the summary collapses to one line and the choice is remembered", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto(`/releases/${CURRENT}`);
  await expect(page.locator("[data-sprint-header]")).toBeVisible();
  await page.locator("[data-summary-toggle]").click();
  await expect(page.locator("[data-sprint-header]")).toHaveCount(0);
  await expect(page.locator("[data-release-risk]")).toHaveCount(0);
  await expect(page.locator("[data-summary-collapsed]")).toContainText("Remaining");
  await page.reload();
  await expect(page.locator("[data-summary-collapsed]")).toBeVisible();
  await page.locator("[data-summary-toggle]").click();
  await expect(page.locator("[data-sprint-header]")).toBeVisible();
  await context.close();
});
