import { expect, test } from "@playwright/test";
import { as, done, editRoute, writesOn } from "./helpers";

// F3: triage mode and snoozes.

// The link can be clicked while the page is still settling; click until it has taken us there.
async function start(page: import("@playwright/test").Page) {
  await expect(async () => {
    await page.locator("[data-start-triage]").click();
    await expect(page).toHaveURL(/\/triage\/run/, { timeout: 8000 });
  }).toPass();
}

const rowIds = (page: import("@playwright/test").Page) => page.locator("[data-row-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-row-id")));

test("start, skip twice, exit: the queue order is unchanged", async ({ browser }) => {
  const { context, page } = await as(browser);
  // Synthetic issues without Priority or Team make the queue long enough to walk.
  await writesOn(page, { extraIssues: 5 });
  await page.goto("/triage");
  await expect(page.locator("[data-row-id]").first()).toBeVisible();
  const before = await rowIds(page);
  expect(before.length).toBeGreaterThanOrEqual(5);
  await start(page);
  const progress = page.locator("[data-triage-progress]");
  await expect(progress).toHaveText(`1 / ${before.length}`);
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(progress).toHaveText(`2 / ${before.length}`);
  await page.keyboard.press("s");
  await expect(progress).toHaveText(`3 / ${before.length}`);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/triage\?tab=needs/);
  await expect(page.locator("[data-row-id]").first()).toBeVisible();
  expect(await rowIds(page)).toEqual(before);
  await context.close();
});

test("writes off: the editing keys say so; Z snoozes and moves on, and the issue leaves the queue", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/triage");
  await expect(page.locator("[data-row-id]").first()).toBeVisible();
  const before = await rowIds(page);
  await start(page);
  const shown = await page.locator("[data-triage-issue]").getAttribute("data-triage-issue");
  await page.keyboard.press("t");
  await expect(page.getByText("Editing is off for this deployment").first()).toBeVisible();
  await page.keyboard.press("z");
  await page.getByRole("dialog", { name: "Snooze until" }).getByRole("button", { name: /Tomorrow/ }).click();
  if (before.length > 1) await expect(page.locator("[data-triage-progress]")).toHaveText(new RegExp(`^2 / ${before.length}$`));
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/triage\?tab=needs/);
  await expect(page.getByRole("button", { name: /^Snoozed \(1\)/ })).toBeVisible();
  await expect.poll(async () => (await rowIds(page)).length).toBe(before.length - 1);
  expect(await page.locator(`[data-issue="${shown}"]`).count()).toBe(0);
  // The server keeps snoozes in memory between tests: leave none behind.
  const { snoozes } = (await (await page.request.get("/api/triage/snoozes")).json()) as { snoozes: { nodeId: string }[] };
  for (const sn of snoozes) await page.request.delete(`/api/triage/snoozes?nodeId=${encodeURIComponent(sn.nodeId)}`);
  await context.close();
});

test("with writes on, 1 sets the highest Priority", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await editRoute(page, done);
  await page.goto("/triage/run?tab=needs");
  await expect(page.locator("[data-triage-issue]")).toBeVisible();
  const top = (await (await page.request.get("/api/data")).json()).meta.fields.priority.at(-1).id;
  await page.keyboard.press("1");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ field: "priority", next: top });
  await context.close();
});

test("a snooze hides the issue whichever GitHub account is connected, and it comes back on its date", async ({ browser }) => {
  const a = await as(browser, "alice");
  const b = await as(browser, "bob");
  const today: string = (await (await a.page.request.get("/api/data")).json()).meta.today;
  const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  await a.page.goto("/triage");
  await expect(a.page.locator("[data-row-id]").first()).toBeVisible();
  const id = (await rowIds(a.page))[0]!;
  const put = (until: string) => a.page.request.put("/api/triage/snoozes", { data: { nodeId: id, until } });

  expect((await put(addDay(today, 1))).ok()).toBe(true);
  await a.page.reload();
  await expect.poll(async () => (await rowIds(a.page)).includes(id)).toBe(false);
  // Another connected account sees the same snooze: it belongs to this install (§4.6, D7).
  await b.page.goto("/triage");
  await expect(b.page.locator("[data-row-id]").first()).toBeVisible();
  await expect.poll(async () => (await rowIds(b.page)).includes(id)).toBe(false);
  expect(((await (await b.page.request.get("/api/triage/snoozes")).json()) as { snoozes: { nodeId: string }[] }).snoozes.map((s) => s.nodeId)).toContain(id);

  // Its day has come: back in the queue.
  expect((await put(today)).ok()).toBe(true);
  await a.page.reload();
  await expect.poll(async () => (await rowIds(a.page)).includes(id)).toBe(true);
  // Clean up (the server keeps snoozes in memory between tests).
  await a.page.request.delete(`/api/triage/snoozes?nodeId=${encodeURIComponent(id)}`);
  await a.context.close();
  await b.context.close();
});

test("the snooze API validates its input and needs a session", async ({ browser, request }) => {
  expect((await request.get("/api/triage/snoozes")).status()).toBe(401);
  const { context, page } = await as(browser);
  expect((await page.request.put("/api/triage/snoozes", { data: { nodeId: "I_x", until: "tomorrow" } })).status()).toBe(400);
  expect((await page.request.put("/api/triage/snoozes", { data: { until: "2026-10-20" } })).status()).toBe(400);
  await context.close();
});
