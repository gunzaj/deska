import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// D4: Settings → Project and fields on the fixture project. Read-only here:
// the mocked server is shared by every spec, so nothing is saved (saving,
// remapping, renames and deleted fields run in tests/electron and tests/sync).
test("Settings shows the project and the suggested mapping by field ID, with dimensions and the Priority order", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Project and fields" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-project-target]")).toContainText("acme/widgets");
  await expect(page.locator("#map-status")).toHaveValue("PVTSSF_acme_status");
  await expect(page.locator("#map-priority")).toHaveValue("PVTSSF_acme_priority");
  await expect(page.locator("#map-sprint")).toHaveValue("PVTIF_acme_release");
  // Low, Medium, High: the last option reads as the highest.
  await expect(page.getByRole("radio", { name: "Last option is the highest priority" })).toBeChecked();
  await expect(page.locator("[data-priority-preview]")).toContainText("High › Medium › Low");
  await expect(page.getByRole("checkbox", { name: /^Team/ })).toBeChecked();
  // Changing the order previews it without saving.
  await page.getByRole("radio", { name: "First option is the highest priority" }).check();
  await expect(page.locator("[data-priority-preview]")).toContainText("Low › Medium › High");
  // No token on this server: no project discovery, and no missing fields.
  await expect(page.getByRole("button", { name: "Change project…" })).toHaveCount(0);
  await expect(page.locator("[data-missing-field]")).toHaveCount(0);
  await context.close();
});
