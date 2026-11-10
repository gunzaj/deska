import { expect, test, type Page } from "@playwright/test";
import { chatOk, mockEndpoint, type MockEndpoint } from "../ai/helpers";
import { as, writesOn } from "./helpers";

// SPEC §4.9, AI1: issue triage suggestions in the issue panel, the free key in
// triage mode and "Suggest for this queue". The model is a mock endpoint on
// 127.0.0.1; nothing real is called. The e2e servers run with writes off, so
// Accept is disabled with the reason.

/** A schema-valid suggestion for fixture issue #102 (Team c0000001, Release e0000023). */
const SUGGESTION = {
  summary: "The app crashes when it starts.",
  status: { id: "a0000002", reason: "Work is underway.", confidence: "medium" },
  priority: { id: "b0000003", reason: "It blocks users.", confidence: "high" },
  dimension: { id: "c0000001", reason: "Dashboard work.", confidence: "medium" },
  sprint: { id: "e0000023", reason: "Fits this release.", confidence: "low" },
  labels: [{ id: "LA_1", reason: "The UI is affected.", confidence: "medium" }],
  duplicateOf: null,
  flags: [{ flag: "needs_info", reason: "No reproduction steps." }],
};

async function configure(page: Page, url: string) {
  const saved = await page.request.post("/api/ai/settings", {
    data: { provider: "openai", model: "tiny-model", baseUrl: url, timeoutSec: 120, extraInstructions: "" },
  });
  expect(saved.ok()).toBe(true);
  const tested = await page.request.post("/api/ai/test");
  expect(await tested.json()).toMatchObject({ ok: true });
}

async function resetAi(page: Page) {
  await page.request.post("/api/ai/settings", {
    data: { provider: "off", model: "sonnet", baseUrl: "", timeoutSec: 120, extraInstructions: "" },
  });
}

/** The mock endpoint answers chat requests with `answer` (and lists a model). */
function answerWith(ep: MockEndpoint, answer: unknown) {
  ep.handle((r) => (r.url.endsWith("/models") ? [200, { data: [{ id: "tiny-model" }] }] : [200, chatOk(answer)]));
}

test("the issue panel shows a suggestion and Accept is disabled while writes are off", async ({ browser }) => {
  const ep = await mockEndpoint();
  const { context, page } = await as(browser);
  try {
    await configure(page, ep.url);
    answerWith(ep, SUGGESTION);
    await page.goto("/issues/102");
    const section = page.getByRole("region", { name: "AI suggestion" });
    await expect(section).toBeVisible();
    await section.getByRole("button", { name: "Suggest with AI" }).click();
    await expect(section).toContainText("The app crashes when it starts.");
    await expect(section).toContainText("In progress");
    await expect(section).toContainText("Needs info");
    await expect(section).toContainText("openai · tiny-model");
    const accept = section.getByRole("button", { name: "Accept" });
    await expect(accept).toBeDisabled();
    await expect(accept).toHaveAttribute("title", "Editing is off for this deployment");
    await section.getByRole("button", { name: "Dismiss" }).click();
    await expect(section.getByRole("button", { name: "Suggest with AI" })).toBeVisible();
  } finally {
    await resetAi(page);
    await context.close();
    await ep.close();
  }
});

test("the free key in triage mode asks for a suggestion", async ({ browser }) => {
  const ep = await mockEndpoint();
  const { context, page } = await as(browser);
  try {
    await configure(page, ep.url);
    answerWith(ep, SUGGESTION);
    await page.goto("/triage/run?tab=needs");
    const section = page.getByRole("region", { name: "AI suggestion" });
    await expect(section).toBeVisible();
    await page.keyboard.press("i");
    await expect(section).toContainText("The app crashes when it starts.");
  } finally {
    await resetAi(page);
    await context.close();
    await ep.close();
  }
});

test("Suggest for this queue confirms a big batch and can be cancelled", async ({ browser }) => {
  const { context, page } = await as(browser);
  // 25 synthetic issues join the one fixture issue in the Needs triage queue.
  await writesOn(page, { extraIssues: 25 });
  const batchId = "11111111-1111-4111-8111-111111111111";
  const job = (i: number, n: number, state: string) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    feature: "issue-triage",
    subject: String(n),
    state,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    resultId: null,
    result: null,
    batchId,
    provider: "openai",
    model: "tiny-model",
  });
  let numbers: number[] = [];
  const cancelled: string[] = [];
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { ready: true, reason: null } }));
  await page.route("**/api/ai/triage-queue", async (route) => {
    numbers = (route.request().postDataJSON() as { numbers: number[] }).numbers;
    await route.fulfill({ json: { batchId, jobs: numbers.map((n, i) => job(i, n, "queued")) } });
  });
  await page.route("**/api/ai/jobs?batch=*", (route) => route.fulfill({ json: { jobs: numbers.map((n, i) => job(i, n, "running")) } }));
  await page.route("**/api/ai/jobs/*/cancel", async (route) => {
    cancelled.push(route.request().url());
    await route.fulfill({ json: { job: job(0, 0, "cancelled") } });
  });
  try {
    await page.goto("/triage?tab=needs");
    await page.getByRole("button", { name: "Suggest for this queue" }).click();
    const dialog = page.getByRole("dialog", { name: "Suggest for this queue" });
    await expect(dialog).toContainText("26 issues");
    await expect(dialog.locator("[data-ai-queue-big]")).toContainText("big batch");
    await dialog.getByRole("button", { name: "Send 26 to the model" }).click();
    await expect(dialog.locator("[data-ai-queue-progress]")).toContainText("of 26");
    await dialog.getByRole("button", { name: "Cancel batch" }).click();
    await expect(dialog.locator("[data-ai-queue-done]")).toContainText("Cancelled after 0 of 26.");
    expect(numbers).toHaveLength(26);
    expect(cancelled).toHaveLength(26);
  } finally {
    await context.close();
  }
});
