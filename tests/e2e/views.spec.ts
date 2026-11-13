import { expect, test, type Browser } from "@playwright/test";
import { as as asUser } from "./helpers";

// Copy view / Import view (SPEC §4.2, D7) through the UI, on the mocked server.

const as = (browser: Browser, login = "alice") => asUser(browser, login, { permissions: ["clipboard-read", "clipboard-write"] });

const unique = (s: string) => `${s} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("a copied view imports as a new view with the same filters and layout; there is no sharing", async ({ browser }) => {
  const { context, page } = await as(browser);
  const name = unique("Open bugs board");
  const created = await page.request.post("/api/views", {
    data: { id: "", name, layout: "board", filters: [{ field: "state", op: "in", values: ["open"] }], sort: [{ field: "updated", dir: "desc" }], groupBy: "status" },
  });
  expect(created.status()).toBe(200);
  const source = (await created.json()) as { id: string };

  await page.goto(`/views/${source.id}`);
  // No visibility mark or toggle: a view is local.
  await expect(page.getByTitle(/Shared view|Personal view/)).toHaveCount(0);
  await page.getByRole("button", { name: "View options" }).click();
  await expect(page.getByRole("option", { name: /Share with team|Make personal/ })).toHaveCount(0);
  await page.getByRole("option", { name: "Copy view" }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(text)).toMatchObject({ kind: "deska-view", view: { name, layout: "board" } });

  await page.goto("/views");
  await page.getByRole("button", { name: "Import view" }).click();
  const dialog = page.getByRole("dialog", { name: "Import view" });
  await dialog.getByLabel("View text").fill("not a view");
  await dialog.getByRole("button", { name: "Import" }).click();
  await expect(dialog.getByRole("alert")).toContainText("isn't a Deska view");
  await dialog.getByLabel("View text").fill(text);
  await dialog.getByRole("button", { name: "Import" }).click();
  await expect(page).toHaveURL(/\/views\/v-/);
  await expect(page.url()).not.toContain(source.id);

  const views = (await (await page.request.get("/api/views")).json()) as { id: string; name: string; layout: string; groupBy?: string }[];
  const copies = views.filter((v) => v.name === name);
  expect(copies).toHaveLength(2);
  expect(new Set(copies.map((v) => `${v.layout}/${v.groupBy}`))).toEqual(new Set(["board/status"]));
  await context.close();
});
