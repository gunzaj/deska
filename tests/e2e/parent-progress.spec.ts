import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// D9 (§4.4): parent issue progress. The fixture epic (#100) has one open child
// (#101), counted by GitHub as 0 of 1.

const kid = (n: number, over: Record<string, unknown> = {}) => ({
  nodeId: `I_kid_${n}`, number: n, title: `Child ${n}`, state: "open", stateReason: null, url: `https://github.com/acme/widgets/issues/${n}`, repo: "acme/widgets", statusOptionId: null, ...over,
});

test("the Epics page shows GitHub's counts as 'pct · done/total'", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/epics");
  await expect(page.locator("[data-sub-progress]").first()).toHaveText("0% · 0/1");
  await context.close();
});

test("the panel shows progress and lists the children, one linking to GitHub", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog?issue=100");
  const section = page.getByRole("region", { name: "Sub-issues" });
  await expect(section).toBeVisible();
  await expect(section.locator("[data-sub-progress]")).toHaveText("0% · 0/1");
  await expect(section.locator("[data-sub-issue='101']")).toContainText("Sub: dashboard widget");
  await expect(section.getByRole("link", { name: "Open #101 on GitHub" })).toHaveAttribute("href", /\/issues\/101$/);
  await context.close();
});

test("a failed later page says 'Showing N of M' and Retry loads the rest", async ({ browser }) => {
  const { context, page } = await as(browser);
  let failed = false;
  await page.route("**/api/issues/100/sub-issues**", (route) => {
    const after = new URL(route.request().url()).searchParams.get("after");
    if (!after) return route.fulfill({ json: { items: [kid(1), kid(2)], total: 3, nextCursor: "C1" } });
    // The second page fails once, then works.
    if (!failed) {
      failed = true;
      return route.fulfill({ status: 502, json: { error: "GitHub request failed" } });
    }
    return route.fulfill({ json: { items: [kid(3, { state: "closed", stateReason: "completed", repo: "acme/gadgets", url: "https://github.com/acme/gadgets/issues/3" })], total: 3, nextCursor: null } });
  });
  await page.goto("/backlog?issue=100");
  const section = page.getByRole("region", { name: "Sub-issues" });
  await expect(section.locator("[data-sub-issue]")).toHaveCount(2);
  await expect(section.locator("[data-sub-issues-partial]")).toContainText("Showing 2 of 3 — couldn't load the rest");
  await section.getByRole("button", { name: "Retry" }).click();
  await expect(section.locator("[data-sub-issue]")).toHaveCount(3);
  await expect(section.locator("[data-sub-issues-partial]")).toHaveCount(0);
  // A child in another repository links out.
  await expect(section.locator("[data-sub-issue='3'] a").first()).toHaveAttribute("href", "https://github.com/acme/gadgets/issues/3");
  await context.close();
});

test("an issue without children has no sub-issues section", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog?issue=102");
  await expect(page.getByRole("complementary", { name: "Issue #102" })).toBeVisible();
  await expect(page.locator("[data-sub-issues]")).toHaveCount(0);
  await context.close();
});

test("the sub-issues API: session required, bad and unknown numbers refused", async ({ browser, request }) => {
  expect((await request.get("/api/issues/100/sub-issues")).status()).toBe(401);
  const { context, page } = await as(browser);
  expect((await page.request.get("/api/issues/abc/sub-issues")).status()).toBe(400);
  expect((await page.request.get("/api/issues/999999/sub-issues")).status()).toBe(404);
  const ok = await page.request.get("/api/issues/100/sub-issues");
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.total).toBe(1);
  expect(body.items.map((i: { number: number }) => i.number)).toEqual([101]);
  await context.close();
});
