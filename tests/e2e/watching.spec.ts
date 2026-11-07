import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// F6: star an issue, see it on the Watching page with what changed, opening it
// clears the change. The fixture servers never see a real sync, so the changes
// endpoint is answered here; the watchlist itself is the real API.

async function cleanup(page: import("@playwright/test").Page) {
  const { watches } = (await (await page.request.get("/api/watches")).json()) as { watches: { kind: string; targetId: string }[] };
  for (const w of watches) await page.request.delete(`/api/watches?kind=${w.kind}&targetId=${encodeURIComponent(w.targetId)}`);
}

test("star an issue in its panel; it shows on Watching with its change; opening it clears the change", async ({ browser }) => {
  const { context, page } = await as(browser);
  await cleanup(page);
  const data = await (await page.request.get("/api/data")).json();
  const issue = data.issues.find((i: { n: number }) => i.n === 102);
  const toStatus = data.meta.fields.status[1].id;
  const fromStatus = data.meta.fields.status[0].id;
  let changesServed = true;
  await page.route("**/api/watches/changes", async (route) => {
    const body = route.request().postDataJSON() as { items: { kind: string; targetId: string }[] };
    const changes: Record<string, unknown[]> = {};
    if (changesServed) for (const it of body.items) changes[`${it.kind}:${it.targetId}`] = [{ issueNodeId: issue.id, field: "status", oldValue: fromStatus, newValue: toStatus, observedAt: new Date().toISOString(), source: "sync" }];
    await route.fulfill({ json: { changes } });
  });

  await page.goto("/backlog?issue=102");
  const panel = page.getByRole("complementary", { name: "Issue #102" });
  await expect(panel).toBeVisible();
  // A click before hydration is lost: click until the star is on (and only while it is off).
  const star = panel.locator("[data-watch-star]");
  await expect(async () => {
    if ((await star.getAttribute("aria-pressed")) !== "true") await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true", { timeout: 1500 });
  }).toPass();
  await expect.poll(async () => ((await (await page.request.get("/api/watches")).json()) as { watches: unknown[] }).watches.length).toBe(1);

  await page.goto("/watching");
  const row = page.locator(`[data-watch="issue:${issue.id}"]`);
  await expect(row).toBeVisible();
  await expect(row.locator("[data-change-count]")).toHaveText("1 change");
  await expect(row.locator('[data-change="status"]')).toContainText("Status:");
  await expect(page.getByRole("link", { name: /^Watching 1$/ })).toBeVisible();

  // Opening the item counts as looking at it.
  changesServed = false;
  await row.getByRole("button", { name: /Bug: crash on start/ }).first().click();
  await expect(page.getByRole("complementary", { name: "Issue #102" })).toBeVisible();
  await page.goto("/watching");
  await expect(row.locator("[data-change-count]")).toHaveText("no changes");

  await row.getByRole("button", { name: "Stop watching" }).click();
  await expect(page.getByText("Nothing watched yet")).toBeVisible();
  await cleanup(page);
  await context.close();
});

test("the watchlist API validates its input, needs a session, and belongs to this install, not to a GitHub account", async ({ browser, request }) => {
  expect((await request.get("/api/watches")).status()).toBe(401);
  const a = await as(browser, "alice");
  const b = await as(browser, "bob");
  await cleanup(a.page);
  expect((await a.page.request.put("/api/watches", { data: { kind: "pull", targetId: "x" } })).status()).toBe(400);
  expect((await a.page.request.put("/api/watches", { data: { kind: "issue" } })).status()).toBe(400);
  expect((await a.page.request.put("/api/watches", { data: { kind: "view", targetId: "v-mine" } })).ok()).toBe(true);
  // Connecting another GitHub account keeps the watchlist (§4.6, D7).
  expect(((await (await b.page.request.get("/api/watches")).json()) as { watches: { targetId: string }[] }).watches.map((w) => w.targetId)).toEqual(["v-mine"]);
  const seen = await a.page.request.post("/api/watches/seen", { data: { kind: "view", targetId: "v-mine" } });
  expect(((await seen.json()) as { watch: { lastSeenAt: string } | null }).watch?.lastSeenAt).toBeTruthy();
  const unwatched = await b.page.request.post("/api/watches/seen", { data: { kind: "view", targetId: "v-other" } });
  expect(((await unwatched.json()) as { watch: unknown }).watch).toBeNull();
  await cleanup(a.page);
  await a.context.close();
  await b.context.close();
});
