import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// F2: the Risk section on a Release page. Fixture Release Sprint 23 (e0000023) is current.

const CURRENT = "e0000023";

test("Risk lists top-priority issues without an assignee and the scope added after the start", async ({ browser }) => {
  const { context, page } = await as(browser);
  let added = "";
  await page.route("**/api/data", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const res = await route.fetch({ headers });
    const json = await res.json();
    const top = json.meta.fields.priority.at(-1).id;
    const open = json.issues.filter((i: { o: number; rl?: string }) => i.o === 1 && i.rl === CURRENT);
    // Two top-priority, unassigned issues in the Release.
    for (const i of open.slice(0, 2)) {
      i.pr = top;
      delete i.as;
    }
    added = open[0].id;
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
  await page.route(`**/api/releases/${CURRENT}/scope-added*`, (route) => route.fulfill({ json: { since: "x", nodeIds: [added] } }));
  await page.goto(`/releases/${CURRENT}`);
  const risk = page.locator("[data-release-risk]");
  await expect(risk).toBeVisible();
  await expect(risk.locator('[data-risk="no-owner"] [data-risk-count]')).toHaveText(/^[12]$/);
  await expect(risk.locator('[data-risk="scope-added"] [data-risk-count]')).toHaveText("1");
  await expect(risk.locator('[data-risk="no-owner"]').getByRole("link", { name: "View in explorer" })).toHaveAttribute("href", /\/issues\?s=/);
  await context.close();
});

test("the scope-added route needs a session and a valid date", async ({ browser, request }) => {
  const anon = await request.get(`/api/releases/${CURRENT}/scope-added?since=2026-10-01`);
  expect(anon.status()).toBe(401);
  const { context, page } = await as(browser);
  expect((await page.request.get(`/api/releases/${CURRENT}/scope-added?since=nope`)).status()).toBe(400);
  const ok = await page.request.get(`/api/releases/${CURRENT}/scope-added?since=2026-10-01`);
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ nodeIds: [] });
  await context.close();
});
