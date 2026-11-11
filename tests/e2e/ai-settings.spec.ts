import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// Settings → AI (AI0, SPEC §4.9): off by default, the per-feature list of what
// is sent, and no model call until a provider is chosen and tested. The server
// side (jobs, Test connection, the key) is covered by Vitest with test doubles.

test("AI assist is off by default and lists what each feature sends", async ({ browser }) => {
  const { context, page } = await as(browser);
  const modelCalls: string[] = [];
  page.on("request", (r) => /\/api\/ai\/(test|jobs)/.test(r.url()) && modelCalls.push(r.url()));
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "AI assist" })).toBeVisible();
  await expect(page.getByLabel("Provider")).toHaveValue("off");
  await expect(page.getByRole("button", { name: "Test connection" })).toHaveCount(0);
  const sends = page.locator("[data-ai-sends]");
  for (const name of ["Issue triage", "Task assist", "Plan my day", "Ask"]) await expect(sends.getByText(name, { exact: false }).first()).toBeVisible();
  await expect(sends.getByText("Never sent:")).toContainText("GitHub token");
  expect(modelCalls).toEqual([]);
  await context.close();
});

test("choosing an endpoint shows its fields, refuses plain http to a public address, and says nothing is sent before the test", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/settings");
  await page.getByLabel("Provider").selectOption("openai");
  await expect(page.getByLabel("Base URL")).toBeVisible();
  await expect(page.getByText("Not tested. Nothing is sent until the test passes.")).toBeVisible();
  await page.getByLabel("Base URL").fill("http://models.example.test/v1");
  await page.getByLabel("Model", { exact: true }).selectOption("__custom");
  await page.getByLabel("Model name").fill("tiny-model");
  await expect(page.getByText("Effort is not available for this provider.")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-ai-message]")).toContainText("Plain http is only allowed");
  // Put it back: the e2e server's database is shared with the other specs.
  await page.getByLabel("Provider").selectOption("off");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-ai-message]")).toContainText("AI assist is off");
  await context.close();
});
