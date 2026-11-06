import { expect, test, type Page } from "@playwright/test";
import { as, done, editRoute } from "./helpers";

// F1: /releases/plan. Fixture Release Sprint 23 (e0000023) is current, Sprint 22
// (e0000022) is the one before. The fixtures have no next Release and nothing
// open in the old one, so the payload is bent per test.

const CURRENT = "e0000023";
const PREVIOUS = "e0000022";

/** Leave two open issues behind in the previous Release; optionally make the current one "next" and turn writes on. */
async function bend(page: Page, opts: { writes: boolean }) {
  await page.route("**/api/data", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const res = await route.fetch({ headers });
    const json = await res.json();
    json.meta.writeMode = opts.writes;
    json.meta.closeBlocked = null;
    if (opts.writes) json.meta.nextReleaseId = CURRENT;
    let left = 0;
    for (const i of json.issues) {
      if (i.o === 1 && left < 2 && i.rl !== CURRENT) {
        i.rl = PREVIOUS;
        left += 1;
      }
    }
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
}

test("plan page: current Release load, carry-over list, and a GitHub search when writes are off", async ({ browser }) => {
  const { context, page } = await as(browser);
  await bend(page, { writes: false });
  await page.goto("/releases/plan");
  await expect(page.getByRole("heading", { name: "Release planning" })).toBeVisible();
  await expect(page.locator(`[data-plan-release="${CURRENT}"]`)).toBeVisible();
  await expect(page.getByText("No next Release yet")).toBeVisible();
  await expect(page.locator("[data-carry-row]").first()).toBeVisible();
  const count = await page.locator("[data-carry-row]").count();
  await expect(page.locator("[data-carry-count]")).toContainText(`${count} open issue`);
  await expect(page.getByRole("link", { name: "Search on GitHub" })).toHaveAttribute("href", /github\.com\/.*\/issues\?q=/);
  await expect(page.getByRole("button", { name: "Copy as GitHub search" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Move .* to Release/ })).toHaveCount(0);
  await context.close();
});

test("plan page with writes on: Move to next sends a release edit per issue", async ({ browser }) => {
  const { context, page } = await as(browser);
  await bend(page, { writes: true });
  const sent = await editRoute(page, done);
  await page.goto("/releases/plan");
  await expect(page.locator("[data-carry-row]").first()).toBeVisible();
  await page.locator("[data-carry-row]").first().getByRole("button", { name: /Move #\d+ to Release/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ field: "release", next: CURRENT });
  await context.close();
});

test("plan page with writes on: Move all sends one edit per carried-over issue", async ({ browser }) => {
  const { context, page } = await as(browser);
  await bend(page, { writes: true });
  const sent = await editRoute(page, done);
  await page.goto("/releases/plan");
  const rows = page.locator("[data-carry-row]");
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  await page.getByRole("button", { name: /^Move all \d+ to Release/ }).click();
  await expect.poll(() => sent.length).toBe(n);
  expect(sent.every((s) => s.field === "release")).toBe(true);
  await context.close();
});
