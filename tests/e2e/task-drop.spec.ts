import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// Drag a task row onto the sidebar: a project, Today, Inbox.

test("drag a task onto a project, Today and Inbox in the sidebar", async ({ browser }) => {
  const { context, page } = await as(browser);
  const stamp = Date.now().toString(36);
  const project = await (await page.request.post("/api/task-projects", { data: { name: `Drop ${stamp}`, color: "green" } })).json();
  const title = `Drag me ${stamp}`;
  const made = await (await page.request.post("/api/tasks", { data: { title } })).json();
  const id: string = made.task.id;
  const task = async () => (await (await page.request.get(`/api/tasks/${id}`)).json()).task as { projectId: string | null; dueDate: string | null };

  await page.goto("/tasks");
  const row = page.locator(`[data-task-row="${id}"]`);
  await expect(row).toBeVisible();
  await expect(page.locator('[data-drop-target="project"]').filter({ hasText: `Drop ${stamp}` })).toBeVisible();

  // Onto a project.
  await row.dragTo(page.locator('[data-drop-target="project"]').filter({ hasText: `Drop ${stamp}` }));
  await expect.poll(async () => (await task()).projectId).toBe(project.id);
  await expect(page.getByText(`Moved to Drop ${stamp}`)).toBeVisible();

  // Onto Today, from the project's own page.
  await page.goto(`/tasks/p/${project.id}`);
  await page.locator(`[data-task-row="${id}"]`).dragTo(page.locator('[data-drop-target="today"]'));
  const today: string = (await (await page.request.get("/api/data")).json()).meta.today;
  await expect.poll(async () => (await task()).dueDate).not.toBeNull();
  expect((await task()).dueDate!.length).toBe(10);
  void today;

  // Back to Inbox.
  await page.locator(`[data-task-row="${id}"]`).dragTo(page.locator('[data-drop-target="inbox"]'));
  await expect.poll(async () => (await task()).projectId).toBeNull();
  await context.close();
});
