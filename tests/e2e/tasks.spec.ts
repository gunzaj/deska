import { expect, test, type Browser } from "@playwright/test";

// Tasks (SPEC §12, milestone T1) on the in-memory task store with mocked auth.
// The store lives for the whole dev server, so every test uses unique titles.

async function as(browser: Browser, login = "alice") {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-e2e-login": login } });
  return { context, page: await context.newPage() };
}

const unique = (s: string) => `${s} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("create, edit, complete and delete a task", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Finish send-flow spec");
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByRole("combobox", { name: "Task" }).fill(title);
  await dialog.getByLabel("Due date").fill("2030-01-15");
  await dialog.getByRole("button", { name: /^Priority/ }).click();
  await page.getByRole("option", { name: /P2 · High/ }).click();
  await dialog.getByRole("button", { name: "Add task" }).click();

  // The new task opens in the side panel.
  const panel = page.getByRole("complementary", { name: "Task" });
  await expect(panel.getByLabel("Title")).toHaveValue(title);
  await expect(panel.getByRole("button", { name: /Priority: P2 High/ })).toBeVisible();

  // Edit the description; it renders as markdown.
  await panel.getByRole("button", { name: "Add description…" }).click();
  await panel.getByLabel("Description").fill("Context: **blocked** on design");
  await panel.getByRole("button", { name: "Save" }).click();
  // The first PATCH may compile /api/tasks/[id] on a cold dev server.
  await expect(panel.locator(".gh-markdown strong")).toHaveText("blocked", { timeout: 20_000 });

  // Complete from the list: it disappears, and "Show completed" brings it back.
  await page.keyboard.press("Escape");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.getByRole("checkbox", { name: `Complete "${title}"` }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Show completed" }).click();
  await expect(row).toBeVisible();
  await row.getByRole("checkbox", { name: `Mark "${title}" as not done` }).click();
  await page.getByRole("button", { name: "Hide completed" }).click();
  await expect(row).toBeVisible();

  // Delete from the panel.
  await row.getByRole("button", { name: title }).click();
  await panel.getByRole("button", { name: "Delete task" }).click();
  await page.getByRole("dialog", { name: "Delete task" }).getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(title)).toHaveCount(0);
  await context.close();
});

test("tasks belong to this install: another GitHub account sees them and can change them", async ({ browser }) => {
  const title = unique("Review PR later");
  const g = await as(browser, "alice");
  const res = await g.page.request.post("/api/tasks", { data: { title, assignee: "bob" } });
  expect(res.status()).toBe(201);
  expect((await res.json()).task).not.toHaveProperty("assignee");
  await g.page.goto("/tasks");
  await expect(g.page.getByText(title)).toBeVisible();
  // There is no Delegated view any more.
  await expect(g.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Delegated" })).toHaveCount(0);

  const m = await as(browser, "bob");
  await m.page.goto("/tasks");
  const row = m.page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row.getByText("from alice")).toHaveCount(0);
  await row.getByRole("button", { name: title }).click();
  const panel = m.page.getByRole("complementary", { name: "Task" });
  await expect(panel.getByRole("button", { name: "Delete task" })).toBeVisible();
  await expect(panel.getByText("Assignee")).toHaveCount(0);
  await Promise.all([g.context.close(), m.context.close()]);
});

test("G then D opens the task inbox", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/my");
  // Focus the page, not the list's search box, so the keys reach the shortcuts.
  await page.getByRole("heading", { name: "My issues" }).click();
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await context.close();
});

test("quick add parses properties, and Backspace keeps a highlight as text", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/my");
  await page.getByRole("heading", { name: "My issues" }).click();
  await page.keyboard.press("q");
  const dialog = page.getByRole("dialog", { name: "New task" });
  const input = dialog.getByRole("combobox", { name: "Task" });
  await expect(input).toBeFocused();

  const name = unique("Write release notes");
  await input.pressSequentially(`${name} tomorrow p1 @bob`);
  const chips = dialog.getByLabel("Recognised properties");
  await expect(chips.getByText("Tomorrow")).toBeVisible();
  await expect(chips.getByText("P1 Urgent")).toBeVisible();
  // There are no assignees (§4.6): @bob is plain title text, with no suggestions and no chip.
  await expect(chips.getByText("@bob")).toHaveCount(0);
  await expect(page.getByRole("listbox", { name: "Suggestions" })).toHaveCount(0);

  await dialog.getByRole("button", { name: 'Keep "p1" as text' }).click();
  await expect(chips.getByText("P1 Urgent")).toHaveCount(0);

  await input.press("Enter");
  const panel = page.getByRole("complementary", { name: "Task" });
  await expect(panel.getByLabel("Title")).toHaveValue(`${name} p1 @bob`);
  await expect(panel.getByRole("button", { name: /Priority: P4 Low/ })).toBeVisible();
  await expect(panel.getByText("Tomorrow")).toBeVisible();
  await context.close();
});

test("add an issue to tasks from its panel; an empty title takes the issue title", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/issues/102");
  const section = page.getByRole("region", { name: "Tasks" });
  await section.getByRole("button", { name: "Add to tasks" }).click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.getByLabel("Attached").getByText("#102")).toBeVisible();
  await dialog.getByRole("button", { name: "Add task" }).click();

  const panel = page.getByRole("complementary", { name: "Task" });
  await expect(panel.getByLabel("Title")).toHaveValue("Bug: crash on start");
  await expect(panel.getByRole("region", { name: "Linked issues" }).getByText("#102")).toBeVisible();

  await page.goto("/issues/102");
  await expect(page.getByRole("region", { name: "Tasks" }).getByRole("button", { name: "Bug: crash on start" })).toBeVisible();
  await context.close();
});

test("T on a focused row and #number in quick add both link issues", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog");
  await page.getByRole("heading", { name: "Backlog" }).click();
  await page.keyboard.press("j");
  await page.keyboard.press("t");
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.getByLabel("Attached")).toBeVisible();
  const input = dialog.getByRole("combobox", { name: "Task" });
  const name = unique("Compare with");
  await input.pressSequentially(`${name} #10`);
  await expect(page.getByRole("listbox", { name: "Suggestions" }).getByRole("option", { name: /Epic: dashboard overhaul/ })).toBeVisible();
  await input.press("Enter"); // picks #100
  await expect(dialog.getByLabel("Recognised properties").getByText("#100")).toBeVisible();
  await input.press("Enter");
  const panel = page.getByRole("complementary", { name: "Task" });
  await expect(panel.getByLabel("Title")).toHaveValue(name);
  await expect(panel.getByRole("region", { name: "Linked issues" }).getByRole("button", { name: /Unlink/ })).toHaveCount(2);
  await context.close();
});

test("a closed linked issue shows a badge and leaves the task open", async ({ browser }) => {
  const { context, page } = await as(browser);
  const name = unique("Verify fix");
  const res = await page.request.post("/api/tasks", { data: { title: name, links: [101] } });
  expect(res.status()).toBe(201);
  // Simulate the next sync: #101 is now closed on GitHub.
  await page.route("**/api/data", async (route) => {
    const r = await route.fetch();
    const body = await r.json();
    for (const i of body.issues) if (i.n === 101) i.o = 0;
    await route.fulfill({ response: r, json: body });
  });
  await page.goto("/tasks");
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row.getByText("Closed")).toBeVisible();
  await expect(row.getByRole("checkbox", { name: `Complete "${name}"` })).toHaveAttribute("aria-checked", "false");
  await context.close();
});

test("projects, labels and Today: quick add files the task; archiving hides it from Inbox", async ({ browser }) => {
  const { context, page } = await as(browser, "bob");
  const project = unique("Specs");
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill(project);
  await page.getByRole("button", { name: "Create project" }).click();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: project })).toBeVisible();

  await page.getByRole("heading", { name: "Inbox" }).click();
  await page.keyboard.press("q");
  const dialog = page.getByRole("dialog", { name: "New task" });
  const name = unique("Write staking spec");
  await dialog.getByRole("combobox", { name: "Task" }).pressSequentially(`${name} today =${project} +specwork`);
  await expect(dialog.getByLabel("Recognised properties").getByText(project)).toBeVisible();
  await expect(dialog.getByLabel("Recognised properties").getByText("specwork", { exact: true })).toBeVisible();
  await dialog.getByRole("combobox", { name: "Task" }).press("Enter");
  await expect(page.getByRole("complementary", { name: "Task" }).getByLabel("Title")).toHaveValue(name);
  await page.keyboard.press("Escape");

  await nav.getByRole("link", { name: "Today" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  await nav.getByRole("link", { name: "specwork", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();

  await nav.getByRole("link", { name: project }).click();
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible();
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText(/Archived: its tasks are hidden/)).toBeVisible();
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
  await context.close();
});

test("sub-tasks: add inline, and completing the parent asks to complete them too", async ({ browser }) => {
  const { context, page } = await as(browser);
  const name = unique("Release checklist");
  const res = await page.request.post("/api/tasks", { data: { title: name } });
  const id = (await res.json()).task.id as string;
  await page.goto(`/tasks?task=${id}`);
  const panel = page.getByRole("complementary", { name: "Task" });
  const add = panel.getByLabel("Add sub-task");
  await add.fill("Changelog");
  await add.press("Enter");
  await add.fill("Screenshots");
  await add.press("Enter");
  const subs = panel.getByRole("region", { name: "Sub-tasks" });
  await expect(subs.getByText("0/2")).toBeVisible();

  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row.getByText("0/2")).toBeVisible();
  await row.getByRole("checkbox", { name: `Complete "${name}"` }).click();
  const confirm = page.getByRole("dialog", { name: "Complete task" });
  await expect(confirm.getByText("2 open sub-tasks")).toBeVisible();
  await confirm.getByRole("button", { name: "Complete all" }).click();
  await expect(subs.getByText("2/2")).toBeVisible();
  await context.close();
});

test("recurring task from quick add: completing moves it to the next weekday", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/tasks");
  await page.getByRole("heading", { name: "Inbox" }).click();
  await page.keyboard.press("q");
  const dialog = page.getByRole("dialog", { name: "New task" });
  const name = unique("Standup notes");
  await dialog.getByRole("combobox", { name: "Task" }).pressSequentially(`${name} every weekday at 9am`);
  const chips = dialog.getByLabel("Recognised properties");
  await expect(chips.getByText("every weekday")).toBeVisible();
  await expect(chips.getByText("09:00")).toBeVisible();
  await dialog.getByRole("combobox", { name: "Task" }).press("Enter");

  const panel = page.getByRole("complementary", { name: "Task" });
  await expect(panel.getByRole("button", { name: "Repeats every weekday" })).toBeVisible();
  const before = await panel.getByLabel("Due date", { exact: true }).inputValue();
  await panel.getByRole("checkbox", { name: `Complete "${name}"` }).click();
  await expect(panel.getByLabel("Due date", { exact: true })).not.toHaveValue(before);
  await expect(panel.getByRole("checkbox", { name: `Complete "${name}"` })).toHaveAttribute("aria-checked", "false");
  await panel.getByRole("button", { name: "Complete forever" }).click();
  await expect(panel.getByRole("checkbox", { name: `Mark "${name}" as not done` })).toBeVisible();
  await context.close();
});

test("repeat picker: a custom every-2-weeks-on-Tue-and-Fri rule moves the due date to its first day", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  const name = unique("Water the plants");
  await dialog.getByRole("combobox", { name: "Task" }).fill(name);
  await dialog.getByLabel("Due date").fill("2030-01-14"); // a Monday
  await dialog.getByRole("button", { name: "Set repeat" }).click();
  const options = page.getByRole("group", { name: "Repeat options" });
  await options.getByRole("button", { name: "Custom…" }).click();
  const custom = page.getByRole("group", { name: "Custom repeat" });
  await custom.getByLabel("Repeat interval").fill("2");
  await custom.getByRole("button", { name: "Monday" }).click(); // the default, the due date's day
  await custom.getByRole("button", { name: "Tuesday" }).click();
  await custom.getByRole("button", { name: "Monday" }).click();
  await custom.getByRole("button", { name: "Friday" }).click();
  await expect(custom.getByText("Every 2 weeks on tue, fri")).toBeVisible();
  await custom.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("button", { name: "Repeats every 2 weeks on tue, fri" })).toBeVisible();
  await expect(dialog.getByLabel("Due date", { exact: true })).toHaveValue("2030-01-15");
  await dialog.getByRole("button", { name: "Add task" }).click();

  const panel = page.getByRole("complementary", { name: "Task" });
  await expect(panel.getByRole("button", { name: "Repeats every 2 weeks on tue, fri" })).toBeVisible();
  await panel.getByRole("checkbox", { name: `Complete "${name}"` }).click();
  await expect(panel.getByLabel("Due date", { exact: true })).toHaveValue("2030-01-18");

  // A preset from the panel, then stop repeating.
  await panel.getByRole("button", { name: "Repeats every 2 weeks on tue, fri" }).click();
  await options.getByRole("button", { name: /^Every weekday/ }).click();
  await expect(panel.getByRole("button", { name: "Repeats every weekday" })).toBeVisible();
  await panel.getByRole("button", { name: "Repeats every weekday" }).click();
  await options.getByRole("button", { name: "Doesn't repeat" }).click();
  await expect(panel.getByRole("button", { name: "Set repeat" })).toBeVisible();
  await context.close();
});

test("notifications: reminders fire into the bell; assigning is gone", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/tasks");
  // A reminder a few seconds from now fires on a later poll. Reminders that
  // came due before the task existed never fire, so create the task first and
  // add the reminder afterwards: a slow CI server can't race it.
  const r = unique("Ping me");
  const created = await page.request.post("/api/tasks", { data: { title: r } });
  expect(created.status()).toBe(201);
  const taskId = (await created.json()).task.id as string;
  const soon = new Date(Date.now() + 3000).toISOString();
  expect((await page.request.patch(`/api/tasks/${taskId}`, { data: { reminders: [{ kind: "absolute", at: soon }] } })).status()).toBe(200);
  expect((await page.request.patch(`/api/tasks/${taskId}`, { data: { assignee: "bob" } })).status()).toBe(400);
  await expect(async () => {
    const list = await (await page.request.get("/api/notifications")).json();
    expect(list.list.some((n: { kind: string; title: string }) => n.kind === "reminder" && n.title === r)).toBe(true);
    expect(list.list.every((n: { kind: string }) => n.kind === "reminder" || n.kind === "watch_digest")).toBe(true);
  }).toPass({ timeout: 15_000, intervals: [1000] });

  const bell = page.getByRole("button", { name: /Notifications, \d+ unread/ });
  await page.reload();
  await expect(bell).toBeVisible();
  await bell.click();
  const entry = page.getByRole("list", { name: "Notifications" }).getByRole("listitem").filter({ hasText: r });
  await entry.click();
  await expect(page.getByRole("complementary", { name: "Task" }).getByLabel("Title")).toHaveValue(r);
  await context.close();
});

test("comments: private notes on a task that you can edit and delete", async ({ browser }) => {
  const { context, page } = await as(browser);
  const name = unique("Spec review together");
  const res = await page.request.post("/api/tasks", { data: { title: name } });
  const id = (await res.json()).task.id as string;
  await page.goto(`/tasks?task=${id}`);
  const panel = page.getByRole("complementary", { name: "Task" });
  const thread = panel.getByRole("region", { name: "Comments" });
  await thread.getByLabel("Write a comment").fill("Please check the **error states** first");
  await thread.getByRole("button", { name: "Comment" }).click();
  await expect(thread.locator(".gh-markdown strong")).toHaveText("error states");
  await expect(thread.getByLabel("Write a comment")).toHaveValue("");
  await expect(thread.getByRole("button", { name: "Delete comment" })).toBeAttached();

  // Another connected GitHub account sees the same note.
  const m = await as(browser, "bob");
  await m.page.goto(`/tasks?task=${id}`);
  const theirs = m.page.getByRole("complementary", { name: "Task" }).getByRole("region", { name: "Comments" });
  await expect(theirs.getByText("error states")).toBeVisible();
  const notes = await (await m.page.request.get("/api/notifications")).json();
  expect(notes.list.some((n: { kind: string }) => n.kind === "comment")).toBe(false);
  await Promise.all([context.close(), m.context.close()]);
});

test("a failed save rolls the optimistic change back and says so", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Rollback check");
  await page.goto("/tasks");
  await page.getByRole("button", { name: "New task" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await dialog.getByRole("combobox", { name: "Task" }).fill(title);
  await dialog.getByRole("button", { name: "Add task" }).click();
  await page.keyboard.press("Escape");
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();

  // The server refuses the save: the row comes back, unchecked.
  await page.route("**/api/tasks/*", (route) =>
    route.request().method() === "PATCH" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }) : route.fallback(),
  );
  await row.getByRole("checkbox", { name: `Complete "${title}"` }).click();
  // The tasks page and the panel area each render the store's error banner.
  await expect(page.getByRole("alert").filter({ hasText: /Could not save task: boom/ }).first()).toBeVisible();
  await expect(row.getByRole("checkbox", { name: `Complete "${title}"` })).toBeVisible();
  await context.close();
});
