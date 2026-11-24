import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// HOME-SPEC §3 and §4: the Home page on the fixture project. The task store
// and the watchlist are shared by every spec on this server, so counts are
// compared with the sidebar's (the same store, read at the same moment) and
// the watchlist is answered here.

const unique = (s: string) => `${s} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SPRINT = "e0000023";

async function openHome(page: Page) {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.locator("[data-home-tile]").first()).toBeVisible();
}

const tileValue = (page: Page, id: string) => page.locator(`[data-home-tile="${id}"] [data-tile-value]`).innerText();
/** The count the sidebar shows next to a link ("" when it shows none, which means 0). */
async function sidebarCount(page: Page, name: string): Promise<string> {
  const text = await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: false }).first().innerText();
  return text.replace(name, "").replace(/\D/g, "") || "0";
}

test("Deska opens on Home, with a greeting, the sprint and what needs triage", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.locator("[data-home-greeting]")).toHaveText(/^Good (morning|afternoon|evening)$/);
  await expect(page.locator("[data-home-context]")).toContainText(/Sprint 23 ends in \d+ days?/);
  await expect(page.locator("[data-home-context]")).toContainText(/need(s)? triage/);
  // Home is the first link of the sidebar and marked as the current page.
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link").first()).toHaveText("Home");
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await context.close();
});

for (const t of [
  { id: "due", url: /\/tasks\/today$/ },
  { id: "mine", url: /\/my$/ },
  { id: "triage", url: /\/triage$/ },
  { id: "watching", url: /\/watching$/ },
  { id: "sprint", url: new RegExp(`/releases/${SPRINT}$`) },
]) {
  test(`the "${t.id}" tile opens its page`, async ({ browser }) => {
    const { context, page } = await as(browser);
    await openHome(page);
    await page.locator(`[data-home-tile="${t.id}"]`).click();
    await expect(page).toHaveURL(t.url);
    await context.close();
  });
}

test("the tiles show the numbers of the pages they open", async ({ browser }) => {
  const { context, page } = await as(browser);
  await openHome(page);
  // The sidebar counts are what My issues, Triage and Today list.
  await expect(async () => {
    expect(await tileValue(page, "mine")).toBe(await sidebarCount(page, "My issues"));
    expect(await tileValue(page, "triage")).toBe(await sidebarCount(page, "Triage"));
    expect(await tileValue(page, "due")).toBe(await sidebarCount(page, "Today"));
  }).toPass();
  // The sprint tile and panel agree with the sprint page's header.
  // "X / Y" without the percentage that follows it in its own element.
  const doneOf = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("*").forEach((child) => child.remove());
      return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
    });
  const done = await doneOf("[data-home-sprint-done]");
  await expect(page.locator('[data-home-tile="sprint"] [data-tile-sub]')).toContainText(`${done} done`);
  await page.locator('[data-home-panel="sprint"]').getByRole("link", { name: "Open sprint" }).click();
  await expect(page).toHaveURL(new RegExp(`/releases/${SPRINT}$`));
  await expect.poll(() => doneOf("[data-sprint-done]")).toBe(done);
  await context.close();
});

test("My work: the tabs switch, the choice is remembered, and an issue row opens the side panel", async ({ browser }) => {
  const { context, page } = await as(browser);
  await openHome(page);
  const panel = page.locator('[data-home-panel="work"]');
  await expect(panel.getByRole("tab", { name: /Today/ })).toHaveAttribute("aria-selected", "true");
  await panel.getByRole("tab", { name: /This sprint/ }).click();
  await expect(panel.getByRole("tabpanel")).toHaveAttribute("data-home-tab", "sprint");
  // Fixture: #100 is alice's, open, in Sprint 23.
  await expect(panel.locator('[data-home-issue="100"]')).toContainText("Epic: dashboard overhaul");
  await page.reload();
  await expect(panel.getByRole("tab", { name: /This sprint/ })).toHaveAttribute("aria-selected", "true");
  await panel.locator('[data-home-issue="100"]').click();
  await expect(page.getByRole("complementary", { name: "Issue #100" })).toBeVisible();
  await page.keyboard.press("Escape");
  await panel.getByRole("tab", { name: /Upcoming/ }).click();
  await expect(panel.getByRole("tabpanel")).toHaveAttribute("data-home-tab", "upcoming");
  await context.close();
});

test("completing a task on Home updates the tile and the sidebar; Undo restores it", async ({ browser }) => {
  const { context, page } = await as(browser);
  const title = unique("Home task");
  await page.goto("/home");
  const today = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
  // Overdue, so it is among the first rows whatever else is due today.
  const due = new Date(`${today}T00:00:00Z`);
  due.setUTCFullYear(due.getUTCFullYear() - 1);
  expect((await page.request.post("/api/tasks", { data: { title, dueDate: due.toISOString().slice(0, 10), priority: 1, links: [101] } })).status()).toBe(201);
  await openHome(page);
  const panel = page.locator('[data-home-panel="work"]');
  await panel.getByRole("tab", { name: /Today/ }).click();
  const row = panel.getByRole("listitem").filter({ hasText: title });
  await expect(row).toBeVisible();
  // A linked task shows the issue's number on its row.
  await expect(row.locator('[data-tab-issue="101"]')).toContainText("#101");
  await expect(page.locator('[data-home-tile="due"] [data-tile-sub]')).toContainText("overdue");
  const agree = () =>
    expect(async () => {
      expect(await tileValue(page, "due")).toBe(await sidebarCount(page, "Today"));
    }).toPass();
  await agree();

  await row.getByRole("checkbox", { name: `Complete "${title}"` }).click();
  await expect(row).toHaveCount(0);
  await agree();
  await page.locator("[data-toast]").filter({ hasText: `Completed “${title}”` }).getByRole("button", { name: "Undo" }).click();
  await expect(row).toBeVisible();
  await agree();
  await context.close();
});

test("G H and the palette open Home; Add task opens quick add", async ({ browser }) => {
  const { context, page } = await as(browser);
  await page.goto("/backlog");
  await expect(page.getByText("Bug: crash on start")).toBeVisible();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await expect(async () => {
    await page.keyboard.press("g");
    await page.keyboard.press("h");
    await expect(page).toHaveURL(/\/home$/, { timeout: 2_000 });
  }).toPass();

  await page.goto("/backlog");
  await expect(page.getByText("Bug: crash on start")).toBeVisible();
  const input = page.getByRole("combobox", { name: "Search commands and issues" });
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(input).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await input.fill("Home");
  await page.getByRole("option", { name: /^Home/ }).first().click();
  await expect(page).toHaveURL(/\/home$/);

  await page.locator("main").getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("dialog", { name: "New task" })).toBeVisible();
  await context.close();
});

test("Create issue is there with writes off, disabled with the reason", async ({ browser }) => {
  const { context, page } = await as(browser);
  await openHome(page);
  const create = page.locator("[data-home-create-issue]");
  await expect(create).toBeDisabled();
  await expect(create).toHaveAttribute("title", /off|Read-only/i);
  await context.close();
});

test("Needs attention lists what is new in triage; a row opens the issue", async ({ browser }) => {
  const { context, page } = await as(browser);
  await openHome(page);
  const panel = page.locator('[data-home-panel="attention"]');
  // Fixture: #102 has no Priority and no Team.
  const row = panel.locator('[data-home-issue="102"]');
  await expect(row).toContainText("Bug: crash on start");
  await expect(row.locator('[data-attention="triage"]')).toHaveText("New in triage");
  await row.click();
  await expect(page.getByRole("complementary", { name: "Issue #102" })).toBeVisible();
  await page.keyboard.press("Escape");
  await panel.getByRole("link", { name: "Open triage" }).click();
  await expect(page).toHaveURL(/\/triage$/);
  await context.close();
});

test("What changed shows the unseen watched changes; Mark all seen clears them", async ({ browser }) => {
  const { context, page } = await as(browser);
  const data = await (await page.request.get("/api/data")).json();
  const issue = data.issues.find((i: { n: number }) => i.n === 102) as { id: string };
  const [from, to] = [data.meta.fields.status[0].id, data.meta.fields.status[1].id];
  const watch = { kind: "issue", targetId: issue.id, lastSeenAt: "2026-01-01T00:00:00.000Z" };
  const seen: unknown[] = [];
  // The watchlist is shared with watching.spec.ts: answered here, never written.
  await page.route("**/api/watches", (route) => (route.request().method() === "GET" ? route.fulfill({ json: { watches: [watch] } }) : route.fallback()));
  await page.route("**/api/watches/changes", (route) =>
    route.fulfill({ json: { changes: seen.length ? {} : { [`issue:${issue.id}`]: [{ issueNodeId: issue.id, field: "status", oldValue: from, newValue: to, observedAt: new Date().toISOString(), source: "sync" }] } } }),
  );
  await page.route("**/api/watches/seen", async (route) => {
    seen.push(route.request().postDataJSON());
    await route.fulfill({ json: { watch: { ...watch, lastSeenAt: new Date().toISOString() } } });
  });

  await openHome(page);
  const panel = page.locator('[data-home-panel="changes"]');
  const line = panel.locator('[data-change="status"]');
  await expect(line).toContainText("#102");
  await expect(line).toContainText("Status:");
  await expect(line).toContainText("→");
  await expect(page.locator('[data-home-tile="watching"] [data-tile-value]')).toHaveText("1");
  await expect(page.locator('[data-home-tile="watching"] [data-tile-sub]')).toHaveText("Unseen changes");

  await panel.locator("[data-home-mark-seen]").click();
  await expect(panel).toContainText("Nothing new in the issues you watch.");
  await expect(page.locator('[data-home-tile="watching"] [data-tile-value]')).toHaveText("0");
  expect(seen).toEqual([{ kind: "issue", targetId: issue.id }]);
  await panel.getByRole("link", { name: "Watching" }).click();
  await expect(page).toHaveURL(/\/watching$/);
  await context.close();
});

test("Epics in this sprint shows GitHub's progress and links to Epics", async ({ browser }) => {
  const { context, page } = await as(browser);
  await openHome(page);
  const panel = page.locator('[data-home-panel="epics"]');
  // Fixture: #100 has one sub-issue, none completed.
  await expect(panel.getByRole("button", { name: /#100/ })).toContainText("0% · 0/1");
  await panel.getByRole("link", { name: "All epics" }).click();
  await expect(page).toHaveURL(/\/epics$/);
  await context.close();
});
