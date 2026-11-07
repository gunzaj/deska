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

test("drag a task between sections: onto a task in another section, and onto a section header", async ({ browser }) => {
  const { context, page } = await as(browser);
  const stamp = Date.now().toString(36);
  const post = async (url: string, data: object) => (await (await page.request.post(url, { data })).json()) as { id: string; task: { id: string } };
  const project = await post("/api/task-projects", { name: `Sections ${stamp}`, color: "teal" });
  const a = await post("/api/task-sections", { projectId: project.id, name: "Alpha" });
  const b = await post("/api/task-sections", { projectId: project.id, name: "Beta" });
  const moving = (await post("/api/tasks", { title: `Mover ${stamp}`, projectId: project.id, sectionId: a.id })).task.id;
  const anchor = (await post("/api/tasks", { title: `Anchor ${stamp}`, projectId: project.id, sectionId: b.id })).task.id;
  const section = async (id: string) => ((await (await page.request.get(`/api/tasks/${id}`)).json()).task as { sectionId: string | null }).sectionId;

  await page.goto(`/tasks/p/${project.id}`);
  const row = page.locator(`[data-task-row="${moving}"]`);
  await expect(row).toBeVisible();

  // Onto a task in Beta: it joins Beta, above that task.
  await row.dragTo(page.locator(`[data-task-row="${anchor}"]`));
  await expect.poll(() => section(moving)).toBe(b.id);
  await expect(page.getByText(`Moved “Mover ${stamp}”`)).toBeVisible();

  // Onto Alpha's (now empty) header: it goes back to the end of Alpha.
  await page.locator(`[data-task-row="${moving}"]`).dragTo(page.getByRole("region", { name: "Alpha" }).getByRole("heading", { level: 2 }));
  await expect.poll(() => section(moving)).toBe(a.id);

  // Onto the header of the tasks in no section.
  await page.locator(`[data-task-row="${moving}"]`).dragTo(page.getByRole("region", { name: "Tasks" }).getByRole("heading", { level: 2 }));
  await expect.poll(() => section(moving)).toBeNull();
  await context.close();
});
