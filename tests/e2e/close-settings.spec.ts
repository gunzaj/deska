import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// W2: Settings → "Done Status for closing" (SPEC §4.8). The options are the
// mapped Status field's options by ID; the route is mocked here.

const OPTIONS = [
  { id: "a0000001", name: "📋 To do", color: "BLUE" },
  { id: "a0000002", name: "🚧 In progress", color: "PURPLE" },
  { id: "a0000006", name: "✅ Done", color: "GREEN" },
];

test("the Done Status for closing is chosen from the mapped Status options and saved", async ({ browser }) => {
  const { context, page } = await as(browser);
  let saved: unknown = null;
  await page.route("**/api/settings/close", async (route) => {
    if (route.request().method() === "POST") {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { doneId: "a0000006" } });
    } else {
      await route.fulfill({ json: { doneId: null, missing: false, options: OPTIONS, statusFieldMissing: false } });
    }
  });
  await page.goto("/settings");
  const section = page.locator("#close");
  await expect(section.getByRole("heading", { name: "Closing issues" })).toBeVisible();
  const select = section.getByRole("combobox", { name: "Done Status for closing" });
  await expect(select).toHaveValue("");
  await expect(section).toContainText("Close is disabled until one is chosen");
  await select.selectOption("a0000006");
  await expect.poll(() => saved).toEqual({ optionId: "a0000006" });
  await context.close();
});

test("a Status field that is missing says to remap it", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.route("**/api/settings/close", (route) =>
    route.fulfill({ json: { doneId: null, missing: false, options: [], statusFieldMissing: true } }),
  );
  await page.goto("/settings");
  await expect(page.locator("#close")).toContainText("Missing field — remap Status");
  await context.close();
});
