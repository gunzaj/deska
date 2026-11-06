import { expect, test } from "@playwright/test";
import { as, done, editRoute, writesOn } from "./helpers";

// U3: task-list keys, a/p/r pickers, multi-key sort.

test("Inbox: J moves focus, E completes, Enter opens", async ({ browser }) => {
  const { context, page } = await as(browser);
  const stamp = Date.now().toString(36);
  const project = await (await page.request.post("/api/task-projects", { data: { name: `Keys ${stamp}`, color: "blue" } })).json();
  for (const t of ["One", "Two", "Three"]) await page.request.post("/api/tasks", { data: { title: `${t} ${stamp}`, projectId: project.id } });
  await page.goto(`/tasks/p/${project.id}`);
  const rows = page.locator("[data-task-row]");
  await expect(rows).toHaveCount(3);
  await rows.first().focus();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("j");
  await page.keyboard.press("e");
  // The completed task leaves the open list.
  await expect(rows).toHaveCount(2);
  await expect(page.getByText(`Two ${stamp}`)).toHaveCount(0);
  await rows.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: "Task" }).getByLabel("Title")).toHaveValue(`One ${stamp}`);
  await context.close();
});

test("a, p and r open the picker for the focused issue; writes off say so", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog");
  const first = page.locator("[data-row-id]").first();
  await expect(first).toBeVisible();
  await first.focus();
  await page.keyboard.press("p");
  await expect(page.getByText("Editing is off for this deployment").first()).toBeVisible();
  await context.close();

  const on = await as(browser);
  await writesOn(on.page);
  await editRoute(on.page, done);
  await on.page.goto("/backlog");
  const row = on.page.locator("[data-row-id]").first();
  await row.focus();
  await on.page.keyboard.press("p");
  await expect(on.page.getByRole("listbox").first()).toBeVisible();
  await on.page.keyboard.press("Escape");
  await on.context.close();
});

test("Shift-click adds sort keys; the display menu lists and removes them", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog");
  const sortFields = () =>
    page.evaluate(() => {
      const raw = new URL(location.href).searchParams.get("s");
      if (!raw) return [] as string[];
      const json = decodeURIComponent(escape(atob(raw.replace(/-/g, "+").replace(/_/g, "/"))));
      return (JSON.parse(json).sort as { field: string }[]).map((x) => x.field);
    });
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("button", { name: "Table" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Sort by Status/ }).click();
  await page.getByRole("button", { name: /^Sort by Release/ }).click({ modifiers: ["Shift"] });
  await expect.poll(sortFields).toEqual(["status", "release"]);
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("button", { name: "Remove sort key 2" }).click();
  await expect.poll(sortFields).toEqual(["status"]);
  await context.close();
});

test("G falls through when the next key is not a destination", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  await page.goto("/backlog");
  const row = page.locator("[data-row-id]").first();
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press("g");
  await page.keyboard.press("x");
  // X selected the focused row: the chord did not swallow the key.
  await expect(row.getByRole("checkbox")).toBeChecked();
  await context.close();
});
