import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// U1: toasts and undo for task delete and complete, announced in a live region.


const unique = (s: string) => `${s} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("delete a task, Undo: it is back with its links and labels", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Undo delete");
  const created = await page.request.post("/api/tasks", { data: { title, links: [101], labels: ["undo-e2e"] } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).task.id as string;

  await page.goto("/tasks");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: title }).click();
  const panel = page.getByRole("complementary", { name: "Task" });
  await panel.getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("dialog", { name: "Delete task" }).getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);

  // The confirmation sits in a polite live region, so screen readers hear it.
  const toast = page.locator('[role="status"][aria-live="polite"] [data-toast]').filter({ hasText: `Deleted “${title}”` });
  // Generous waits: on a cold `next dev` the delete and restore routes compile
  // on first use (CI runners are slow).
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(row).toBeVisible({ timeout: 15_000 });

  const back = (await (await page.request.get(`/api/tasks/${id}`)).json()).task;
  expect(back.links.map((l: { number: number }) => l.number)).toEqual([101]);
  expect(back.labels).toHaveLength(1);
  await context.close();
});

test("complete a task, Undo: it is open again", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Undo complete");
  await page.request.post("/api/tasks", { data: { title } });
  await page.goto("/tasks");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("checkbox", { name: `Complete "${title}"` }).click();
  await expect(row).toHaveCount(0);
  await page.locator("[data-toast]").filter({ hasText: `Completed “${title}”` }).getByRole("button", { name: "Undo" }).click();
  await expect(row.getByRole("checkbox", { name: `Complete "${title}"` })).toBeVisible();
  await context.close();
});

test("complete a recurring task, Undo: its due date is back", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Undo weekly");
  const created = await page.request.post("/api/tasks", { data: { title, dueDate: "2030-01-15", recurrence: { rule: "FREQ=WEEKLY", text: "every week" } } });
  const id = (await created.json()).task.id as string;
  await page.goto("/tasks");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("checkbox", { name: `Complete "${title}"` }).click();
  const toast = page.locator("[data-toast]").filter({ hasText: `Completed “${title}”` });
  await expect(toast).toContainText("2030-01-22");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/tasks/${id}`)).json()).task.dueDate).toBe("2030-01-15");
  await context.close();
});

test("Esc dismisses the newest toast", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Esc toast");
  await page.request.post("/api/tasks", { data: { title } });
  await page.goto("/tasks");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("checkbox", { name: `Complete "${title}"` }).click();
  const toast = page.locator("[data-toast]").filter({ hasText: `Completed “${title}”` });
  await expect(toast).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toast).toHaveCount(0);
  await context.close();
});
