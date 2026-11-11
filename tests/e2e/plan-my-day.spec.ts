import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// SPEC §4.9, AI3: "Plan my day" on Today. The AI API routes are mocked in the
// browser (like AI2's spec), so the specs never touch the shared AI settings and
// never call a model. The task store is the real in-memory one; every test uses
// unique titles. The plan names one overdue task created here, fixture issue #100,
// and two values that do not exist, to check that only local data is shown.

const JOB_ID = "22222222-2222-4222-8222-222222222222";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const MISSING_TASK_ID = "11111111-1111-4111-8111-111111111111";
const DONE_AT = "2026-11-10T09:00:00.000Z";
const ISSUE_NUMBER = 100;
const ISSUE_TITLE = "Epic: dashboard overhaul";

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

type Task = { id: string; title: string; dueDate: string | null; dueTime: string | null; links: { kind: string; nodeId: string; number: number }[] };

const unique = (s: string) => `${s} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** `date` moved by `days`, as YYYY-MM-DD (UTC, like the server's dates). */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today from the server clock, the same day the page's clock uses. */
async function todayOf(page: Page): Promise<string> {
  const data = (await (await page.request.get("/api/data")).json()) as { meta: { today: string } };
  return data.meta.today;
}

function job(state: Job["state"], result: unknown = null, over: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    feature: "plan-my-day",
    subject: "2026-11-10",
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

/** A schema-valid plan: one real overdue task, fixture issue #100, and two values that do not exist. */
const suggestion = (taskId: string, newDate: string) => ({
  summary: "A short day: clear the overdue work first.",
  items: [
    { kind: "task", id: taskId, reason: "It was due yesterday, so it comes first.", dueDate: newDate, dueTime: null },
    { kind: "issue", id: String(ISSUE_NUMBER), reason: "It is assigned to you in the current sprint.", dueDate: null, dueTime: null },
    { kind: "task", id: MISSING_TASK_ID, reason: "A task that does not exist.", dueDate: null, dueTime: null },
    { kind: "issue", id: "9999", reason: "An issue the cache does not have.", dueDate: null, dueTime: null },
  ],
});

/** The GET answer when no plan is stored yet: AI ready, two candidates to plan from. */
const readyView = { plan: null, candidates: { tasks: 1, issues: 1 }, ai: { ready: true, reason: null } };

/**
 * Mock the plan routes: the GET returns today's view, the POST one job (done at once,
 * or polled through /api/ai/jobs), and the outcome route records what was accepted.
 */
async function mockPlan(
  page: Page,
  opts: { post?: Job; polled?: Job; view?: unknown; outcomes?: string[] } = {},
): Promise<string[]> {
  const calls: string[] = [];
  await page.route("**/api/ai/plan-my-day*", async (route) => {
    const method = route.request().method();
    calls.push(method);
    if (method === "POST") await route.fulfill({ json: { job: opts.post ?? job("done") } });
    else await route.fulfill({ json: opts.view ?? readyView });
  });
  if (opts.polled) {
    await page.route("**/api/ai/jobs/**", async (route) => {
      await route.fulfill({ json: { job: opts.polled as Job } });
    });
  }
  await page.route("**/api/ai/results/*/outcome", async (route) => {
    const body = route.request().postDataJSON() as { outcome: string };
    opts.outcomes?.push(body.outcome);
    await route.fulfill({ json: { outcome: body.outcome } });
  });
  return calls;
}

/** Create a real overdue task through the API; returns it as the server stored it. */
async function createOverdueTask(page: Page, title: string, dueDate: string): Promise<Task> {
  const res = await page.request.post("/api/tasks", { data: { title, dueDate } });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { task: Task };
  expect(body.task).toMatchObject({ title, dueDate });
  return body.task;
}

/** Read the in-memory task store through the real API (page.request bypasses page.route). */
async function savedTask(page: Page, title: string): Promise<Task | undefined> {
  const body = (await (await page.request.get("/api/tasks")).json()) as { tasks: Task[] };
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

/** Remove any leftover task linking the fixture issue, so the test starts from a known state. */
async function dropTasksLinkedTo(page: Page, number: number): Promise<void> {
  const body = (await (await page.request.get("/api/tasks")).json()) as { tasks: Task[] };
  for (const task of body.tasks) {
    if (task.links.some((l) => l.number === number)) await page.request.delete(`/api/tasks/${task.id}`);
  }
}

test("the plan names only existing tasks and issues", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    const today = await todayOf(page);
    const title = unique("Finish the report");
    const task = await createOverdueTask(page, title, addDays(today, -1));
    await mockPlan(page, { post: job("running"), polled: job("done", suggestion(task.id, today)) });
    await page.goto("/tasks/today");
    await expect(page.locator(`[data-task-row="${task.id}"]`)).toContainText(title);

    await page.locator("[data-ai-plan-open]").click();
    const dialog = page.getByRole("dialog", { name: "Plan my day" });
    await expect(dialog).toBeVisible();
    await dialog.locator("[data-ai-plan-start]").click();

    const taskRow = dialog.locator(`[data-ai-plan-item="${task.id}"]`);
    const issueRow = dialog.locator(`[data-ai-plan-item="${ISSUE_NUMBER}"]`);
    await expect(taskRow).toContainText(title);
    await expect(issueRow).toContainText(ISSUE_TITLE);
    await expect(issueRow).toContainText(`#${ISSUE_NUMBER}`);
    await expect(dialog.locator("[data-ai-plan-summary]")).toContainText("A short day");
    // The plan names a task id and an issue number that do not exist: neither is shown.
    await expect(dialog.locator(`[data-ai-plan-item="${MISSING_TASK_ID}"]`)).toHaveCount(0);
    await expect(dialog.locator('[data-ai-plan-item="9999"]')).toHaveCount(0);
    // Nothing was written: opening the dialog only read, and starting only asked the model.
    const stored = await savedTask(page, title);
    expect(stored?.dueDate).toBe(addDays(today, -1));
  } finally {
    await context.close();
  }
});

test("accepting a new date changes it with Undo", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    const today = await todayOf(page);
    const title = unique("Send the invoice");
    const original = addDays(today, -1);
    const task = await createOverdueTask(page, title, original);
    const outcomes: string[] = [];
    const patches = watchPatches(page);
    await mockPlan(page, { post: job("done", suggestion(task.id, today)), outcomes });
    await page.goto("/tasks/today");
    await expect(page.locator(`[data-task-row="${task.id}"]`)).toContainText(title);

    await page.locator("[data-ai-plan-open]").click();
    const dialog = page.getByRole("dialog", { name: "Plan my day" });
    await expect(dialog.locator("[data-ai-plan-start]")).toBeVisible();
    await dialog.locator("[data-ai-plan-start]").click();
    const row = dialog.locator(`[data-ai-plan-item="${task.id}"]`);
    await expect(row).toContainText(title);
    await expect(row).toContainText("Accept");

    await row.locator("[data-ai-plan-accept]").click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toMatchObject({ dueDate: today, dueTime: null });
    await expect.poll(async () => (await savedTask(page, title))?.dueDate).toBe(today);
    // The task is no longer overdue, so the plan has no new date for it any more.
    await expect(row.locator("[data-ai-plan-accept]")).toHaveCount(0);
    await expect.poll(() => outcomes.filter((o) => o === "accepted").length).toBe(1);

    const toast = page.locator("[data-toast]").filter({ hasText: "Moved" });
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1]).toMatchObject({ dueDate: original, dueTime: null });
    await expect.poll(async () => (await savedTask(page, title))?.dueDate).toBe(original);
  } finally {
    await context.close();
  }
});

test('"Add to tasks" on a suggested issue creates a linked task', async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    const today = await todayOf(page);
    const title = unique("Draft the spec");
    const task = await createOverdueTask(page, title, addDays(today, -1));
    await dropTasksLinkedTo(page, ISSUE_NUMBER);
    const outcomes: string[] = [];
    const posts: Record<string, unknown>[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/tasks") posts.push(r.postDataJSON() as Record<string, unknown>);
    });
    await mockPlan(page, { post: job("done", suggestion(task.id, today)), outcomes });
    await page.goto("/tasks/today");
    await expect(page.locator(`[data-task-row="${task.id}"]`)).toContainText(title);

    await page.locator("[data-ai-plan-open]").click();
    const dialog = page.getByRole("dialog", { name: "Plan my day" });
    await expect(dialog.locator("[data-ai-plan-start]")).toBeVisible();
    await dialog.locator("[data-ai-plan-start]").click();
    const row = dialog.locator(`[data-ai-plan-item="${ISSUE_NUMBER}"]`);
    await expect(row).toContainText(ISSUE_TITLE);

    await row.locator("[data-ai-plan-add-task]").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ title: ISSUE_TITLE, links: [ISSUE_NUMBER] });
    // The POST was sent, not necessarily answered: wait for the saved task.
    await expect.poll(async () => (await savedTask(page, ISSUE_TITLE))?.links.map((l) => l.number)).toEqual([ISSUE_NUMBER]);
    // A task now links the issue: the row offers no second one.
    await expect(row.locator("[data-ai-plan-add-task]")).toBeDisabled();
    await expect(row.locator("[data-ai-plan-add-task]")).toContainText("Already in tasks");
    await expect.poll(() => outcomes.filter((o) => o === "accepted").length).toBe(1);

    const toast = page.locator("[data-toast]").filter({ hasText: "Added" });
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => Boolean(await savedTask(page, ISSUE_TITLE))).toBe(false);
  } finally {
    await context.close();
  }
});

test("nothing changes without Accept", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    const today = await todayOf(page);
    const title = unique("Review the notes");
    const original = addDays(today, -1);
    const task = await createOverdueTask(page, title, original);
    const outcomes: string[] = [];
    // Record task writes from here on: creating the fixture above is not one of them.
    const writes: string[] = [];
    page.on("request", (r) => {
      const method = r.method();
      const path = new URL(r.url()).pathname;
      if ((method === "PATCH" || method === "POST" || method === "DELETE") && (path === "/api/tasks" || path.startsWith("/api/tasks/"))) {
        writes.push(`${method} ${path}`);
      }
    });
    await mockPlan(page, { post: job("done", suggestion(task.id, today)), outcomes });
    await page.goto("/tasks/today");
    await expect(page.locator(`[data-task-row="${task.id}"]`)).toContainText(title);
    // The task still has its original date before the dialog is opened.
    expect((await savedTask(page, title))?.dueDate).toBe(original);

    await page.locator("[data-ai-plan-open]").click();
    const dialog = page.getByRole("dialog", { name: "Plan my day" });
    await expect(dialog.locator("[data-ai-plan-start]")).toBeVisible();
    // Reading today's plan sent nothing; running one only asked the model, and its
    // answer changes nothing until an item is accepted.
    expect(writes).toEqual([]);
    await dialog.locator("[data-ai-plan-start]").click();
    await expect(dialog.locator(`[data-ai-plan-item="${task.id}"]`)).toContainText(title);
    await expect(dialog.locator(`[data-ai-plan-item="${ISSUE_NUMBER}"]`)).toContainText(ISSUE_TITLE);
    expect(writes).toEqual([]);
    expect(outcomes).toEqual([]);
    expect((await savedTask(page, title))?.dueDate).toBe(original);
  } finally {
    await context.close();
  }
});

test("with AI off the dialog shows the reason and sends no job", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    await todayOf(page);
    const reason = "AI assist is off. Choose a provider in Settings → AI.";
    const calls: string[] = [];
    await page.route("**/api/ai/status", (route) => route.fulfill({ json: { ready: false, reason } }));
    await page.route("**/api/ai/plan-my-day*", async (route) => {
      calls.push(route.request().method());
      await route.fulfill({ json: { plan: null, candidates: { tasks: 1, issues: 1 }, ai: { ready: false, reason } } });
    });
    await page.goto("/tasks/today");
    await page.locator("[data-ai-plan-open]").click();
    const dialog = page.getByRole("dialog", { name: "Plan my day" });
    await expect(dialog).toContainText("Choose a provider");
    await expect(dialog.locator("[data-ai-plan-start]")).toHaveCount(0);
    expect(calls).toEqual(["GET"]);
  } finally {
    await context.close();
  }
});
