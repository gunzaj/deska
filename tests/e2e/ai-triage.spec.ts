import { expect, test, type Page } from "@playwright/test";
import { as, writesOn } from "./helpers";

// SPEC §4.9, AI1: issue triage suggestions in the issue panel, the free key in
// triage mode and "Suggest for this queue". The AI API routes are mocked here so
// the specs never touch the shared AI settings (the e2e servers are shared with
// other specs); the server side (jobs, storage, schema) is covered by Vitest.

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

const JOB_ID = "22222222-2222-4222-8222-222222222222";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const DONE_AT = "2026-11-10T09:00:00.000Z";

const job = (state: string, over: Record<string, unknown> = {}) => ({
  id: JOB_ID,
  feature: "issue-triage",
  subject: "102",
  state,
  createdAt: DONE_AT,
  finishedAt: state === "done" ? DONE_AT : null,
  error: null,
  resultId: state === "done" ? RESULT_ID : null,
  result: state === "done" ? SUGGESTION : null,
  batchId: null,
  provider: "openai",
  model: "tiny-model",
  ...over,
});

/** Intercept the issue's AI routes: ready, a suggestion run, a poll and the outcome. */
async function mockSuggestion(page: Page) {
  const sent: string[] = [];
  await page.route("**/api/issues/102/ai", async (route) => {
    sent.push(route.request().method());
    if (route.request().method() === "POST") await route.fulfill({ json: { job: job("running") } });
    else await route.fulfill({ json: { suggestion: null, ai: { ready: true, reason: null } } });
  });
  await page.route("**/api/ai/jobs/*", (route) => route.fulfill({ json: { job: job("done") } }));
  await page.route("**/api/ai/results/*/outcome", async (route) => {
    const body = route.request().postDataJSON() as { outcome: string; parts?: string[] };
    sent.push(`outcome:${body.outcome}${body.parts ? `:${body.parts.join(",")}` : ""}`);
    await route.fulfill({ json: { outcome: body.outcome, applied: body.parts ?? ["status", "priority"], unchanged: [] } });
  });
  return sent;
}

test("the issue panel shows a suggestion and Accept is disabled while writes are off", async ({ browser }) => {
  const { context, page } = await as(browser);
  const sent = await mockSuggestion(page);
  try {
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
    // React's dev StrictMode mounts the section twice: two GETs on open.
    expect(sent.filter((s) => s !== "GET")).toEqual(["POST", "outcome:dismissed"]);
    expect(sent.filter((s) => s === "GET").length).toBeGreaterThanOrEqual(1);
  } finally {
    await context.close();
  }
});

test("the free key in triage mode asks for a suggestion", async ({ browser }) => {
  const { context, page } = await as(browser);
  await mockSuggestion(page);
  try {
    await page.goto("/triage/run?tab=needs");
    const section = page.getByRole("region", { name: "AI suggestion" });
    await expect(section).toBeVisible();
    await page.keyboard.press("i");
    await expect(section).toContainText("The app crashes when it starts.");
  } finally {
    await context.close();
  }
});

test("Suggest for this queue confirms a big batch and can be cancelled", async ({ browser }) => {
  const { context, page } = await as(browser);
  // 25 synthetic issues join the one fixture issue in the Needs triage queue.
  await writesOn(page, { extraIssues: 25 });
  const batchId = "11111111-1111-4111-8111-111111111111";
  const batchJob = (i: number, n: number, state: string) => job(state, { id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, subject: String(n), batchId });
  let numbers: number[] = [];
  const cancelled: string[] = [];
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { ready: true, reason: null } }));
  await page.route("**/api/ai/triage-queue", async (route) => {
    numbers = (route.request().postDataJSON() as { numbers: number[] }).numbers;
    await route.fulfill({ json: { batchId, jobs: numbers.map((n, i) => batchJob(i, n, "queued")) } });
  });
  await page.route("**/api/ai/jobs?batch=*", (route) => route.fulfill({ json: { jobs: numbers.map((n, i) => batchJob(i, n, "running")) } }));
  await page.route("**/api/ai/jobs/*/cancel", async (route) => {
    cancelled.push(route.request().url());
    await route.fulfill({ json: { job: batchJob(0, 0, "cancelled") } });
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

test("with writes on, Accept applies the suggestion through the write gate", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await mockSuggestion(page);
  try {
    await page.goto("/issues/102");
    const section = page.getByRole("region", { name: "AI suggestion" });
    await section.getByRole("button", { name: "Suggest with AI" }).click();
    await expect(section.getByRole("button", { name: "Accept" })).toBeEnabled();
    await section.getByRole("button", { name: "Accept" }).click();
    await expect.poll(() => sent.find((s) => s.startsWith("outcome:accepted"))).toBe("outcome:accepted");
    await expect(page.locator("[data-toast]").filter({ hasText: "Accepted: status, priority." })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("Edit applies only the parts the user keeps", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await mockSuggestion(page);
  try {
    await page.goto("/issues/102");
    const section = page.getByRole("region", { name: "AI suggestion" });
    await section.getByRole("button", { name: "Suggest with AI" }).click();
    await section.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Accept suggestion" });
    await expect(dialog).toContainText("Apply which parts?");
    await dialog.getByRole("checkbox", { name: "status" }).uncheck();
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => sent.find((s) => s.startsWith("outcome:accepted"))).toBe("outcome:accepted:priority,dimension,sprint,labels");
    await expect(section.getByRole("button", { name: "Suggest with AI" })).toBeVisible();
  } finally {
    await context.close();
  }
});
