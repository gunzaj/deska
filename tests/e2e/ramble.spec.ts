import { expect, test, type Browser } from "@playwright/test";

// Item 13: Ramble. The microphone and the AI are stubbed: the transcript,
// the parse and the batch create are the server's, never a real model call.

async function as(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-e2e-login": "alice" } });
  return { context, page: await context.newPage() };
}

const job = (state: string, over: Record<string, unknown> = {}) => ({
  id: "job-ramble-1",
  feature: "ramble",
  subject: "ramble:abc",
  state,
  createdAt: "2026-11-11T10:00:00.000Z",
  finishedAt: state === "done" ? "2026-11-11T10:00:02.000Z" : null,
  error: null,
  resultId: null,
  result: null,
  batchId: null,
  provider: "claude-code",
  model: "sonnet",
  startedAt: "2026-11-11T10:00:00.100Z",
  queueMs: 100,
  durationMs: 1900,
  providerMs: 1800,
  providerApiMs: 1500,
  ...over,
});

const parsed = {
  tasks: [
    { title: "Buy milk", dueDate: "2026-11-12", dueTime: null, priority: 4, projectId: null, sectionId: null, labelIds: [], reason: "Shopping." },
    { title: "Call the dentist", dueDate: "2026-11-13", dueTime: null, priority: 2, projectId: null, sectionId: null, labelIds: [], reason: "A call to make." },
  ],
};

test("reviews a transcript, creates one batch, and keeps the review when the create fails", async ({ browser }) => {
  const { context, page } = await as(browser);
  const bodies: { idempotencyKey: string; tasks: { title: string }[] }[] = [];
  let fail = true;
  await page.route("**/api/ai/ramble", (route) => route.fulfill({ status: 200, json: { job: job("done", { result: parsed }) } }));
  await page.route("**/api/ai/jobs/*", (route) => route.fulfill({ status: 200, json: { job: job("done", { result: parsed }) } }));
  await page.route("**/api/tasks/batch", (route) => {
    const body = route.request().postDataJSON() as { idempotencyKey: string; tasks: { title: string }[] };
    bodies.push(body);
    if (fail) return route.fulfill({ status: 500, json: { error: "The database is busy." } });
    return route.fulfill({ status: 201, json: { tasks: [] } });
  });

  await page.goto("/tasks");
  await page.getByRole("button", { name: "Ramble" }).click();
  const dialog = page.getByRole("dialog", { name: "Ramble" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Transcript").fill("Buy milk tomorrow. Call the dentist on Friday.");
  await dialog.getByRole("button", { name: "Read transcript" }).click();
  await expect(dialog.getByRole("heading", { name: "Review 2 tasks" })).toBeVisible();
  await expect(dialog.locator("[data-ramble-row]")).toHaveCount(2);

  await dialog.getByLabel("Task 1 title").fill("Buy oat milk");
  await dialog.getByRole("button", { name: "Remove task 2" }).click();
  await expect(dialog.locator("[data-ramble-row]")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Add task" }).click();
  await dialog.getByLabel("Task 2 title").fill("Water the plants");

  await dialog.getByRole("button", { name: "Create 2 tasks" }).click();
  await expect(dialog.getByRole("alert")).toContainText("The database is busy.");
  await expect(dialog.getByLabel("Transcript")).toHaveValue("Buy milk tomorrow. Call the dentist on Friday.");
  await expect(dialog.locator("[data-ramble-row]")).toHaveCount(2);

  fail = false;
  await dialog.getByRole("button", { name: "Create 2 tasks" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Created 2 tasks." })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Ramble" })).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[1]!.idempotencyKey).toBeTruthy();
  expect(bodies[1]!.tasks.map((t) => t.title)).toEqual(["Buy oat milk", "Water the plants"]);
  await context.close();
});

test("microphone denial keeps the transcript and says why", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-e2e-login": "alice" } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
    });
  });
  await page.goto("/tasks");
  await page.getByRole("button", { name: "Ramble" }).click();
  const dialog = page.getByRole("dialog", { name: "Ramble" });
  await dialog.getByLabel("Transcript").fill("Typed tasks");
  await dialog.getByRole("button", { name: "Record" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Microphone access was denied");
  await expect(dialog.getByLabel("Transcript")).toHaveValue("Typed tasks");
  await context.close();
});

test("AI off keeps the transcript as one row to create", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.route("**/api/ai/ramble", (route) => route.fulfill({ status: 200, json: { job: job("error", { error: { code: "off", message: "AI assist is off. Choose a provider in Settings → AI." } }) } }));
  await page.goto("/tasks");
  await page.getByRole("button", { name: "Ramble" }).click();
  const dialog = page.getByRole("dialog", { name: "Ramble" });
  await dialog.getByLabel("Transcript").fill("Buy milk tomorrow");
  await dialog.getByRole("button", { name: "Read transcript" }).click();
  await expect(dialog.getByRole("alert")).toContainText("AI assist is off");
  await expect(dialog.getByRole("heading", { name: "Review the task" })).toBeVisible();
  await expect(dialog.getByLabel("Task 1 title")).toHaveValue("Buy milk tomorrow");
  await expect(dialog.getByLabel("Transcript")).toHaveValue("Buy milk tomorrow");
  await context.close();
});
