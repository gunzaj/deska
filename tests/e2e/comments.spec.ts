import { expect, test, type Page } from "@playwright/test";
import { as, writesOn } from "./helpers";

// Commenting from the issue panel (SPEC §4.8). The e2e server runs with writes
// off, so these tests turn them on in /api/data and answer the comments route
// themselves: nothing is ever written to GitHub.

async function openBug(page: Page) {
  await page.goto("/backlog");
  await page.getByText("Bug: crash on start").click();
  const panel = page.getByRole("complementary", { name: "Issue #102" });
  await expect(panel).toBeVisible();
  return panel;
}

type Sent = { body: string; idempotencyKey: string };

/** Answer POST /api/issues/102/comments; returns what the panel sent. */
async function commentsRoute(page: Page, reply: (body: Sent, n: number) => { status: number; json: unknown }) {
  const sent: Sent[] = [];
  await page.route("**/api/issues/102/comments", async (route) => {
    const body = route.request().postDataJSON() as Sent;
    sent.push(body);
    const r = reply(body, sent.length);
    await route.fulfill({ status: r.status, contentType: "application/json", json: r.json });
  });
  return sent;
}

const URL_9001 = "https://github.com/acme/widgets/issues/102#issuecomment-9001";
const posted = { status: 201, json: { entry: { id: "e", status: "done", error: null, result: { id: "9001", url: URL_9001 } } } };

/** The thread GitHub holds after the comment: what the re-read (`?fresh=1`) answers. */
async function freshThread(page: Page, html: string) {
  let reads = 0;
  await page.route(/\/api\/issues\/102\?fresh=1/, async (route) => {
    reads += 1;
    await route.fulfill({
      json: {
        number: 102,
        body: "",
        bodyHtml: null,
        comments: [{ id: "9001", author: "alice", avatarUrl: null, createdAt: new Date().toISOString(), body: "raw", bodyHtml: html, url: URL_9001 }],
        commentsError: null,
        source: "github",
      },
    });
  });
  return () => reads;
}

test("with writes off the comment box is disabled and says why", async ({ browser }) => {
  const { context, page } = await as(browser);
  const panel = await openBug(page);
  const box = panel.getByRole("textbox", { name: "Add a comment" });
  await expect(box).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Comment" })).toBeDisabled();
  await expect(panel.locator("[data-comment-box]")).toContainText(/Editing is off|Read-only token|GitHub writes/);
  await context.close();
});

test("⌘↵ posts the comment: it shows at once, the box empties, then GitHub's rendering replaces it", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await commentsRoute(page, () => posted);
  const reads = await freshThread(page, "<p>Fixed in <strong>the next build</strong>.</p>");
  const panel = await openBug(page);
  const box = panel.getByRole("textbox", { name: "Add a comment" });
  await expect(panel.getByRole("button", { name: "Comment" })).toBeDisabled();
  await box.fill("  Fixed in **the next build**.  ");
  await box.press("ControlOrMeta+Enter");
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.body).toBe("Fixed in **the next build**.");
  expect(sent[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  await expect(box).toHaveValue("");
  await expect.poll(reads).toBe(1);
  await expect(panel.locator("strong", { hasText: "the next build" })).toBeVisible();
  await expect(panel.getByText("1 comment")).toBeVisible();
  await context.close();
});

test("the Comment button posts too; the draft survives opening another issue", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await commentsRoute(page, () => posted);
  await freshThread(page, "<p>Second try</p>");
  const panel = await openBug(page);
  await panel.getByRole("textbox", { name: "Add a comment" }).fill("Second try");
  await page.keyboard.press("Escape");
  await page.getByText("Sub: dashboard widget").click();
  await expect(page.getByRole("complementary", { name: "Issue #101" }).getByRole("textbox", { name: "Add a comment" })).toHaveValue("");
  await page.keyboard.press("Escape");
  // No reload: the draft is kept in memory.
  await page.getByText("Bug: crash on start").click();
  const again = page.getByRole("complementary", { name: "Issue #102" });
  await expect(again.getByRole("textbox", { name: "Add a comment" })).toHaveValue("Second try");
  await again.getByRole("button", { name: "Comment" }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.body).toBe("Second try");
  await context.close();
});

test("a failed comment keeps the text and says why", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  await commentsRoute(page, () => ({ status: 502, json: { entry: { id: "e", status: "failed", error: "HTTP 403: issue is locked" } } }));
  const panel = await openBug(page);
  const box = panel.getByRole("textbox", { name: "Add a comment" });
  await box.fill("Still relevant?");
  await panel.getByRole("button", { name: "Comment" }).click();
  await expect(page.getByText("Couldn't post the comment: HTTP 403: issue is locked")).toBeVisible();
  await expect(box).toHaveValue("Still relevant?");
  await expect(panel.getByRole("button", { name: "Comment" })).toBeEnabled();
  await context.close();
});

test("a queued comment (202) is watched: once the outbox has sent it the thread is read again", async ({ browser }) => {
  const { context, page } = await as(browser);
  await writesOn(page);
  const sent = await commentsRoute(page, () => ({ status: 202, json: { entry: { id: "e", status: "pending", error: null } } }));
  let listed = true;
  await page.route("**/api/outbox?mine=1", async (route) => {
    const entries = listed && sent[0] ? [{ id: "e", issueNodeId: "I_bug", op: "comment", field: "comment", idempotencyKey: `alice:${sent[0].idempotencyKey}`, status: "pending", error: null }] : [];
    await route.fulfill({ json: { entries } });
  });
  const reads = await freshThread(page, "<p>Sent in the end</p>");
  const panel = await openBug(page);
  const box = panel.getByRole("textbox", { name: "Add a comment" });
  await box.fill("Sent in the end");
  await box.press("ControlOrMeta+Enter");
  await expect(panel.locator("[data-comment-box]")).toContainText("GitHub is slow to answer");
  await expect(panel.getByRole("button", { name: "Comment" })).toBeDisabled();
  expect(reads()).toBe(0);
  listed = false;
  await expect.poll(reads, { timeout: 15_000 }).toBe(1);
  await expect(panel.getByText("Sent in the end")).toBeVisible();
  await expect(box).toHaveValue("");
  await context.close();
});
