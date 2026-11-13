import { expect, test } from "@playwright/test";
import { as } from "./helpers";

// Task fixes (FIX-SPEC group 5) that need a browser. Unique titles: the task store lives for the whole dev server.
const unique = (s: string) => `${s} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("T-6: a task can be dragged below the last one, and the order holds after a reload", async ({ browser }) => {
  const { context, page } = await as(browser);
  const project = await (await page.request.post("/api/task-projects", { data: { name: unique("Order"), color: "teal" } })).json();
  const ids: string[] = [];
  for (const title of ["First", "Second", "Third"]) {
    ids.push((await (await page.request.post("/api/tasks", { data: { title: `${title} ${project.id.slice(0, 4)}`, projectId: project.id } })).json()).task.id);
  }
  await page.goto(`/tasks/p/${project.id}`);
  const order = async () => page.locator("[data-task-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-task-row")));
  await expect.poll(order).toEqual(ids);
  await page.locator(`[data-task-row="${ids[0]}"]`).dragTo(page.locator("[data-end-drop]").first());
  await expect.poll(order).toEqual([ids[1], ids[2], ids[0]]);
  await page.reload();
  await expect.poll(order).toEqual([ids[1], ids[2], ids[0]]);
  await context.close();
});

test("T-7: a duplicate label name shows an alert in the dialog; a double Enter makes one label", async ({ browser }) => {
  const { context, page } = await as(browser);
  const name = unique("waiting").replace(/ /g, "-");
  await page.goto("/tasks");
  const open = async () => {
    await page.getByRole("button", { name: "New label" }).click();
    return page.getByRole("dialog", { name: "New label" });
  };
  let dialog = await open();
  await dialog.getByLabel("Label name").fill(name);
  await dialog.getByLabel("Label name").press("Enter");
  await dialog.getByLabel("Label name").press("Enter").catch(() => undefined);
  await expect(dialog).toHaveCount(0);
  const labels = async () => ((await (await page.request.get("/api/tasks")).json()).labels as { name: string }[]).filter((l) => l.name === name);
  expect(await labels()).toHaveLength(1);
  await expect(page.getByRole("alert").filter({ hasText: "Could not" })).toHaveCount(0);

  dialog = await open();
  await dialog.getByLabel("Label name").fill(name.toUpperCase());
  await dialog.getByLabel("Label name").press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  expect(await labels()).toHaveLength(1);
  await context.close();
});

test("T-5: a completed task the store doesn't hold opens from Completed", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Oldest done");
  const oldest = (await (await page.request.post("/api/tasks", { data: { title } })).json()).task.id as string;
  await page.request.patch(`/api/tasks/${oldest}`, { data: { completed: true } });
  // The store holds only the newest 200 completions; leave this one out of its
  // load, as if 200 newer ones had pushed it out. (Making 201 real tasks took
  // minutes and left them in the shared store for every later spec, issue #6.)
  await page.route("**/api/tasks", async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    json.tasks = (json.tasks as { id: string }[]).filter((t) => t.id !== oldest);
    await route.fulfill({ response: res, json });
  });
  await page.goto("/tasks/completed");
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Task" }).getByLabel("Title")).toHaveValue(title);
  await page.request.delete(`/api/tasks/${oldest}`);
  await context.close();
});

test("T-9: undoing a recurring completion closes the sub-tasks it reopened", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Weekly review");
  const parent = (await (await page.request.post("/api/tasks", { data: { title, dueDate: "2030-01-15", recurrence: { rule: "FREQ=WEEKLY", text: "every week" } } })).json()).task.id as string;
  const child = (await (await page.request.post("/api/tasks", { data: { title: `Sub ${title}`, parentId: parent } })).json()).task.id as string;
  await page.request.patch(`/api/tasks/${child}`, { data: { completed: true } });
  const done = async () => Boolean((await (await page.request.get(`/api/tasks/${child}`)).json()).task.completedAt);
  await page.goto("/tasks");
  const row = page.getByRole("listitem").filter({ hasText: title }).first();
  await row.getByRole("checkbox", { name: `Complete "${title}"` }).click();
  const toast = page.locator("[data-toast]").filter({ hasText: `Completed “${title}”` });
  await expect(toast).toContainText("2030-01-22");
  await expect.poll(done).toBe(false); // the sub-task reopened for the next occurrence
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect.poll(done).toBe(true);
  await context.close();
});
