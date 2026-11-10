import { expect, test, type Page } from "@playwright/test";
import { as, done, editRoute, writesOn } from "./helpers";

// W2: close / reopen (SPEC §4.8). The e2e server runs with writes off, so these
// tests turn them on in the payload and answer the edit route themselves.

async function openBug(page: Page) {
  await page.goto("/backlog");
  await page.getByText("Bug: crash on start").click();
  const panel = page.getByRole("complementary", { name: "Issue #102" });
  await expect(panel).toBeVisible();
  return panel;
}

test("Close sets state and the completed reason; Reopen sends the state only", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await editRoute(page, done);
  const panel = await openBug(page);
  const close = panel.getByRole("button", { name: /Close issue/ });
  await expect(close).toBeEnabled();
  await close.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({ field: "state", base: "open", next: "closed" });
  await expect(panel.getByRole("button", { name: /Reopen issue/ })).toBeVisible();
  // Reopen leaves Status alone: the request is the state only (W2).
  await panel.getByRole("button", { name: /Reopen issue/ }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({ field: "state", base: "closed", next: "open" });
  await context.close();
});

test("until a Done Status is chosen, Close is disabled with the reason", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const reason = "Choose a Done Status for closing in Settings → Project and fields";
  await page.route("**/api/data", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const res = await route.fetch({ headers });
    const json = await res.json();
    json.meta.writeMode = true;
    json.meta.closeBlocked = reason;
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
  const sent = await editRoute(page, done);
  const panel = await openBug(page);
  const close = panel.getByRole("button", { name: /Close issue/ });
  await expect(close).toHaveAttribute("aria-disabled", "true");
  await expect(close).toHaveAttribute("title", reason);
  await close.click({ force: true });
  expect(sent).toEqual([]);
  await context.close();
});
