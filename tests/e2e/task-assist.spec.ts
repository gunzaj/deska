import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// SPEC §4.9, AI2: task assist in the in-app quick add, the global quick-add
// window and "Tidy Inbox". The AI routes are mocked in the browser (like AI1's
// spec), so the specs never touch the shared AI settings and never call a model.
// The task store is the real in-memory one; every test uses unique titles.

const JOB_ID = "22222222-2222-4222-8222-222222222222";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const BATCH_ID = "11111111-1111-4111-8111-111111111111";
const DONE_AT = "2026-11-10T09:00:00.000Z";

type Job = {
  id: string;
  feature: string;
  subject: string;
  state: "queued" | "running" | "done" | "error" | "cancelled";
  createdAt: string;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
  resultId: string | null;
  result: unknown;
  batchId: string | null;
  provider: string | null;
  model: string | null;
};

const unique = (s: string) => `${s} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function job(state: Job["state"], result: unknown = null, over: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    feature: "task-assist",
    subject: "quick-add:test",
    state,
    createdAt: DONE_AT,
    finishedAt: state === "done" || state === "error" ? DONE_AT : null,
    error: state === "error" ? { code: "unreachable", message: "The endpoint did not answer." } : null,
    resultId: state === "done" ? RESULT_ID : null,
    result: state === "done" ? result : null,
    batchId: null,
    provider: "openai",
    model: "tiny-model",
    ...over,
  };
}

/** A schema-valid quick-add suggestion for the given project and label. */
const suggestion = (title: string, projectId: string, labelId: string) => ({
  title,
  dueDate: "2030-01-15",
  dueTime: null,
  recurrence: null,
  priority: 2,
  reason: "It has a date and a priority.",
  projectId,
  sectionId: null,
  labelIds: [labelId],
  issueNumber: null,
});

/** Create one project and one label through the real API; both are unique to this test. */
async function createProjectAndLabel(page: Page) {
  const projectName = unique("AI project");
  const labelName = unique("ai-label");
  const projectRes = await page.request.post("/api/task-projects", { data: { name: projectName } });
  expect(projectRes.status()).toBe(201);
  const project = (await projectRes.json()) as { id: string };
  const labelRes = await page.request.post("/api/task-labels", { data: { name: labelName } });
  expect(labelRes.status()).toBe(201);
  const label = (await labelRes.json()) as { id: string };
  return { project, projectName, label, labelName };
}

/** Read the in-memory task store through the real API (page.request bypasses page.route). */
async function savedTask(page: Page, title: string) {
  const body = (await (await page.request.get("/api/tasks")).json()) as { tasks: Record<string, unknown>[] };
  return body.tasks.find((t) => t.title === title);
}

/** The task PATCHes the page sent, in order (the store's update route). */
function watchPatches(page: Page): Record<string, unknown>[] {
  const patches: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && /\/api\/tasks\/[0-9a-f-]{36}$/.test(r.url())) patches.push(r.postDataJSON() as Record<string, unknown>);
  });
  return patches;
}

test("✨ on a typed line gives chips that only name the existing project and label", async ({ browser }) => {
  const { context, page } = await as(browser);
  const { project, projectName, label, labelName } = await createProjectAndLabel(page);
  const title = unique("Plan the offsite");
  const sent: string[] = [];
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { ready: true, reason: null } }));
  await page.route("**/api/ai/task-assist", async (route) => {
    sent.push((route.request().postDataJSON() as { text: string }).text);
    await route.fulfill({ json: { job: job("done", suggestion(`${title} (AI)`, project.id, label.id)) } });
  });
  await page.route("**/api/ai/results/*/outcome", async (route) => {
    sent.push(`outcome:${(route.request().postDataJSON() as { outcome: string }).outcome}`);
    await route.fulfill({ json: { outcome: "accepted" } });
  });
  try {
    await page.goto("/tasks");
    // The suggestion's names come from the task store: wait for it to have loaded.
    await expect(page.locator('[data-drop-target="project"]').filter({ hasText: projectName })).toBeVisible();
    await page.getByRole("button", { name: "New task" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    const input = dialog.getByRole("combobox", { name: "Task" });
    await input.fill(title);
    await dialog.locator("[data-ai-assist]").click();
    const chips = dialog.locator("[data-ai-chips]");
    await expect(chips).toBeVisible();
    await expect(chips).toContainText(projectName);
    await expect(chips).toContainText(labelName);
    await expect(chips).toContainText("P2 High");
    expect(sent).toContain(title);

    await dialog.getByRole("button", { name: "Add task" }).click();
    const panel = page.getByRole("complementary", { name: "Task" });
    await expect(panel.getByLabel("Title")).toHaveValue(`${title} (AI)`);
    const saved = await savedTask(page, `${title} (AI)`);
    expect(saved).toMatchObject({ projectId: project.id, priority: 2, dueDate: "2030-01-15", labels: [label.id] });
    await expect.poll(() => sent.includes("outcome:accepted")).toBe(true);
  } finally {
    await context.close();
  }
});

test("Enter without ✨ sends no AI request and saves the plain parse", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Call the dentist");
  const aiRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/ai/")) aiRequests.push(r.url());
  });
  try {
    await page.goto("/tasks");
    await page.getByRole("button", { name: "New task" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    const input = dialog.getByRole("combobox", { name: "Task" });
    await input.fill(`${title} tomorrow high`);
    await dialog.getByRole("button", { name: "Add task" }).click();
    const panel = page.getByRole("complementary", { name: "Task" });
    await expect(panel.getByLabel("Title")).toHaveValue(title);
    const saved = await savedTask(page, title);
    expect(saved).toMatchObject({ priority: 2, dueTime: null });
    expect(saved!.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(aiRequests).toEqual([]);
  } finally {
    await context.close();
  }
});

test("a failed provider call says AI unavailable and Enter saves the plain parse", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Buy milk");
  const outcomes: string[] = [];
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { ready: true, reason: null } }));
  await page.route("**/api/ai/task-assist", (route) => route.fulfill({ json: { job: job("error") } }));
  await page.route("**/api/ai/results/*/outcome", (route) => {
    outcomes.push((route.request().postDataJSON() as { outcome: string }).outcome);
    return route.fulfill({ json: { outcome: "accepted" } });
  });
  try {
    await page.goto("/tasks");
    await page.getByRole("button", { name: "New task" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    const input = dialog.getByRole("combobox", { name: "Task" });
    await input.fill(`${title} tomorrow`);
    await dialog.locator("[data-ai-assist]").click();
    await expect(dialog.locator("[data-ai-assist-error]")).toContainText("AI unavailable");

    await input.press("Enter");
    const panel = page.getByRole("complementary", { name: "Task" });
    await expect(panel.getByLabel("Title")).toHaveValue(title);
    const saved = await savedTask(page, title);
    expect(saved).toMatchObject({ priority: 4 });
    expect(saved!.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(outcomes).toEqual([]);
  } finally {
    await context.close();
  }
});

test("✨ with AI off shows the reason and sends no job", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Write the notes");
  let taskAssistCalls = 0;
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { ready: false, reason: "AI assist is off. Choose a provider in Settings → AI." } }));
  await page.route("**/api/ai/task-assist", (route) => {
    taskAssistCalls++;
    return route.fulfill({ json: {} });
  });
  try {
    await page.goto("/tasks");
    await page.getByRole("button", { name: "New task" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New task" });
    await dialog.getByRole("combobox", { name: "Task" }).fill(title);
    await dialog.locator("[data-ai-assist]").click();
    await expect(dialog.locator("[data-ai-assist-error]")).toContainText("Choose a provider");
    expect(taskAssistCalls).toBe(0);
  } finally {
    await context.close();
  }
});

test("Tidy Inbox accepts a suggestion per task and all, with Undo", async ({ browser }) => {
  const { context, page } = await as(browser);
  const { project, projectName, label, labelName } = await createProjectAndLabel(page);
  const titleA = unique("Draft the agenda");
  const titleB = unique("Book the room");
  const taskA = (await (await page.request.post("/api/tasks", { data: { title: titleA } })).json()).task as { id: string };
  const taskB = (await (await page.request.post("/api/tasks", { data: { title: titleB } })).json()).task as { id: string };
  const tidySuggestion = (title: string, resultId: string, over: Record<string, unknown> = {}) => ({
    id: resultId,
    result: {
      title: `${title} (tidied)`,
      dueDate: "2030-01-15",
      dueTime: null,
      recurrence: null,
      priority: 2,
      reason: "It has a date and a priority.",
      projectId: project.id,
      sectionId: null,
      labelIds: [label.id],
      issueNumber: null,
      ...over,
    },
    provider: "openai",
    model: "tiny-model",
    createdAt: DONE_AT,
    acceptedAt: null,
    dismissedAt: null,
    fresh: true,
  });
  const view = {
    tasks: [
      { taskId: taskA.id, title: titleA, suggestion: tidySuggestion(titleA, RESULT_ID) },
      { taskId: taskB.id, title: titleB, suggestion: tidySuggestion(titleB, "44444444-4444-4444-8444-444444444444") },
    ],
    total: 2,
    ai: { ready: true, reason: null },
  };
  const outcomes: string[] = [];
  await page.route("**/api/ai/tidy-inbox", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: view });
    return route.fulfill({ json: { batchId: BATCH_ID, jobs: [], total: 2 } });
  });
  await page.route("**/api/ai/results/*/outcome", (route) => {
    outcomes.push((route.request().postDataJSON() as { outcome: string }).outcome);
    return route.fulfill({ json: { outcome: "accepted" } });
  });
  const patches = watchPatches(page);
  try {
    await page.goto("/tasks");
    await expect(page.getByRole("listitem").filter({ hasText: titleA })).toBeVisible();
    await page.locator("[data-ai-tidy-open]").click();
    const dialog = page.getByRole("dialog", { name: "Tidy Inbox" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-ai-tidy-count]")).toContainText("2 Inbox tasks");
    const rowA = dialog.locator(`[data-ai-tidy-task="${taskA.id}"]`);
    const rowB = dialog.locator(`[data-ai-tidy-task="${taskB.id}"]`);
    await expect(rowA).toContainText(titleA);
    await expect(rowB).toContainText(titleB);
    await expect(rowA.locator('[data-ai-chip="project"]')).toContainText(projectName);
    await expect(rowA.locator('[data-ai-chip="label"]')).toContainText(labelName);
    await expect(rowA).toContainText("It has a date and a priority.");

    // Accept one task: the local edit goes through the normal task PATCH; Undo puts it back.
    await rowA.getByRole("button", { name: "Accept" }).click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toMatchObject({ title: `${titleA} (tidied)`, dueDate: "2030-01-15", dueTime: null, priority: 2, projectId: project.id, sectionId: null, labels: [labelName] });
    const toastA = page.locator("[data-toast]").filter({ hasText: "Tidied" });
    await expect(toastA).toBeVisible();
    await toastA.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1]).toMatchObject({ title: titleA, dueDate: null, dueTime: null, priority: 4, projectId: null, sectionId: null, labels: [] });

    await rowB.getByRole("button", { name: "Accept" }).click();
    await expect.poll(() => patches.length).toBe(3);
    expect(patches[2]).toMatchObject({ title: `${titleB} (tidied)`, projectId: project.id, labels: [labelName] });
    const toastB = page.locator("[data-toast]").filter({ hasText: "Tidied" });
    await expect(toastB).toBeVisible();
    await toastB.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => patches.length).toBe(4);

    // Closing and reopening starts clean; Accept all applies both with one Undo.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.locator("[data-ai-tidy-open]").click();
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-ai-tidy-accept-all]").click();
    await expect.poll(() => patches.length).toBe(6);
    expect(patches[4]).toMatchObject({ title: `${titleA} (tidied)` });
    expect(patches[5]).toMatchObject({ title: `${titleB} (tidied)` });
    const toastAll = page.locator("[data-toast]").filter({ hasText: "Tidied 2 tasks" });
    await expect(toastAll).toBeVisible();
    await toastAll.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => patches.length).toBe(8);
    expect(patches[6]).toMatchObject({ title: titleA, projectId: null });
    expect(patches[7]).toMatchObject({ title: titleB, projectId: null });
    await expect.poll(() => outcomes.filter((o) => o === "accepted").length).toBe(4);
  } finally {
    await context.close();
  }
});

test("the global quick-add window shows AI chips and Enter saves them", async ({ browser }) => {
  const { context, page } = await as(browser);
  const { project, projectName, label, labelName } = await createProjectAndLabel(page);
  const title = unique("Water the plants");
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { ready: true, reason: null } }));
  await page.route("**/api/ai/task-assist", async (route) => {
    await route.fulfill({ json: { job: job("done", { ...suggestion(title, project.id, label.id), priority: 1 }) } });
  });
  try {
    await page.goto("/quick-add");
    const input = page.getByRole("combobox", { name: "Task" });
    await input.fill(title);
    await page.locator("[data-ai-assist]").click();
    const chips = page.locator("[data-ai-chips]");
    await expect(chips).toContainText(projectName);
    await expect(chips).toContainText(labelName);
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/tasks") && r.request().method() === "POST");
    await input.press("Enter");
    expect((await saved).status()).toBe(201);
    const task = await savedTask(page, title);
    expect(task).toMatchObject({ projectId: project.id, priority: 1, dueDate: "2030-01-15", labels: [label.id] });
  } finally {
    await context.close();
  }
});
