import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// W3: creating an issue (SPEC §4.8). The e2e server runs with writes off, so
// these tests turn them on in the payload and answer the create route themselves.

type Pending = { id: string; title: string; status: "pending" | "sending" }[];

/** Writes on in /api/data, with the create jobs GitHub has not confirmed yet. */
async function writesOn(page: Page, pending: () => Pending) {
  await page.route("**/api/data", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const res = await route.fetch({ headers });
    const json = await res.json();
    json.meta.writeMode = true;
    json.meta.closeBlocked = null;
    const p = pending();
    if (p.length) json.meta.pendingCreates = p;
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
}

async function openForm(page: Page) {
  await page.getByRole("button", { name: "New issue" }).click();
  const dialog = page.getByRole("dialog", { name: "Create issue" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("the form sends title, body, Type, labels, assignees, milestone and the mapped fields as one create", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page, () => []);
  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/issues", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { entry: { id: "ob-1", status: "done", result: { nodeId: "I_created", number: 999 } } } });
  });
  await page.goto("/issues");
  const dialog = await openForm(page);
  await dialog.getByLabel("Title").fill("New issue from Deska");
  await dialog.getByLabel("Description").fill("With a body.");
  await dialog.getByLabel("Type").selectOption("IT_acme_feature");
  await dialog.getByLabel("Milestone").selectOption("M_1");
  await dialog.getByLabel("Status").selectOption("a0000001");
  await dialog.getByLabel("Priority").selectOption("b0000003");
  await dialog.getByLabel("Release").selectOption("e0000023");
  await dialog.getByLabel("Team").selectOption("c0000002");
  // Labels: a searchable picker (item 11), not a wall of checkboxes.
  await dialog.getByRole("button", { name: "Labels" }).click();
  await page.getByPlaceholder("Search labels…").fill("ui");
  await page.getByRole("option", { name: "UI" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.locator('[data-create-chips="labels"]')).toContainText("UI");
  // Assignees: the same searchable picker, so a big org doesn't flood the form.
  await dialog.getByRole("button", { name: "Assignees" }).click();
  await page.getByPlaceholder("Search assignees…").fill("ali");
  await page.getByRole("option", { name: "alice" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.locator('[data-create-chips="assignees"]')).toContainText("alice");
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect.poll(() => sent).toMatchObject({
    title: "New issue from Deska",
    body: "With a body.",
    typeId: "IT_acme_feature",
    milestoneId: "M_1",
    labelIds: ["LA_1"],
    assigneeLogins: ["alice"],
    fields: expect.arrayContaining([
      { field: "status", next: "a0000001" },
      { field: "priority", next: "b0000003" },
      { field: "release", next: "e0000023" },
      { field: "dim:PVTSSF_acme_team", next: "c0000002" },
    ]),
  });
  await expect(page.locator("[data-toast]").filter({ hasText: "Created #999." })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Create issue" })).toHaveCount(0);
  await context.close();
});

test("an unconfirmed create shows a pending row until GitHub confirms it", async ({ browser }) => {
  const { context, page } = await as(browser);
  let pending: Pending = [];
  await writesOn(page, () => pending);
  await page.route("**/api/issues", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    pending = [{ id: "ob-1", title: "Slow to create", status: "pending" }];
    await route.fulfill({ status: 202, json: { entry: { id: "ob-1", status: "pending", result: null } } });
  });
  await page.goto("/issues");
  const dialog = await openForm(page);
  await dialog.getByLabel("Title").fill("Slow to create");
  await dialog.getByRole("button", { name: "Create issue" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Queued" })).toBeVisible();
  // The refresh after the 202 shows the create job as a pending row (never a made-up issue).
  await page.reload();
  await expect(page.locator("[data-pending-create]")).toContainText("Slow to create");
  await expect(page.locator("[data-pending-create]")).toContainText("pending");
  await context.close();
});

test("with writes off the form is visible but Create is disabled with the reason", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/issues");
  const dialog = await openForm(page);
  await dialog.getByLabel("Title").fill("Cannot create this");
  const submit = dialog.getByRole("button", { name: "Create issue" });
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute("title", "Editing is off for this deployment");
  await expect(dialog).toContainText("Editing is off for this deployment");
  await context.close();
});

test("on a short window the form scrolls and Create stays on screen", async ({ browser }) => {
  const { context, page } = await as(browser, "alice", { viewport: { width: 1000, height: 520 } });
  await page.goto("/issues");
  const dialog = await openForm(page);
  // The dialog never grows past the window, so its body scrolls instead of being cut off.
  const box = await dialog.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(520);
  expect(await dialog.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  // The footer sticks to the bottom: Cancel and Create are reachable without scrolling.
  await expect(dialog.getByRole("button", { name: "Create issue" })).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeInViewport();
  await context.close();
});
