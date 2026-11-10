import { expect, test } from "@playwright/test";
import { as, writesOn } from "./helpers";

// SPEC §4.9, AI4: "Ask" in the issue panel and "Ask about this list" on issue
// lists. The AI API routes are mocked in the browser (like AI1's spec), so the
// specs never touch the shared AI settings and never call a model. The server side
// (jobs, `ai_results`, references) is covered by Vitest.

const JOB_ID = "22222222-2222-4222-8222-222222222222";
const RESULT_ID = "33333333-3333-4333-8333-333333333333";
const DONE_AT = "2026-11-10T09:00:00.000Z";
const QUESTION = "Why does the app crash on start?";
const ANSWER = "The dashboard widget loads before the cache is ready, so the start screen crashes.";
const ANSWER_HTML = `<p>${ANSWER} See <a href="https://github.com/acme/widgets/issues/100">#100</a>.</p>`;
const LIST_QUESTION = "Which issues are about the dashboard?";
const LIST_ANSWER = "Two issues touch the dashboard: #101 and #102.";
const LIST_ANSWER_HTML = `<p>Two issues touch the dashboard: <a href="https://github.com/acme/widgets/issues/101">#101</a> and #102.</p>`;

const job = (state: "queued" | "running" | "done" | "error" | "cancelled") => ({
  id: JOB_ID,
  feature: "ask",
  subject: "102",
  state,
  createdAt: DONE_AT,
  finishedAt: state === "done" || state === "error" ? DONE_AT : null,
  error: null,
  resultId: state === "done" ? RESULT_ID : null,
  result: null,
  batchId: null,
  provider: "openai",
  model: "tiny-model",
});

/** The stored answer: a question, its sanitized HTML, references, model and time. */
function answerOf(question: string, answer: string, answerHtml: string, references: number[], fresh: boolean) {
  return {
    id: RESULT_ID,
    question,
    answer,
    answerHtml,
    references,
    provider: "openai",
    model: "tiny-model",
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    fresh,
  };
}

/** The numbers the list GET asked for. */
type ListGet = { numbers: number[]; total: number };
/** The body the list POST sent. */
type ListPost = { question: string; numbers: number[]; total: number };

test("the issue panel answers a question and its references open inside Deska", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    let runs = 0;
    let dismissed = false;
    const posted: unknown[] = [];
    const outcomes: string[] = [];
    await page.route("**/api/issues/*/ask", async (route) => {
      const number = Number(new URL(route.request().url()).pathname.split("/")[3]);
      if (number !== 102) {
        // The other issues' panels stay clean after a reference is opened.
        await route.fulfill({ json: { answer: null, ai: { ready: false, reason: null } } });
        return;
      }
      if (route.request().method() === "POST") {
        runs++;
        posted.push(route.request().postDataJSON());
        await route.fulfill({ json: { job: job("running") } });
        return;
      }
      const stored = runs > 0 && !(runs === 1 && dismissed);
      await route.fulfill({ json: { answer: stored ? answerOf(QUESTION, ANSWER, ANSWER_HTML, [100], runs > 1) : null, ai: { ready: true, reason: null } } });
    });
    await page.route("**/api/ai/jobs/*", (route) => route.fulfill({ json: { job: job("done") } }));
    await page.route("**/api/ai/results/*/outcome", async (route) => {
      const body = route.request().postDataJSON() as { outcome: string };
      dismissed = body.outcome === "dismissed";
      outcomes.push(body.outcome);
      await route.fulfill({ json: { outcome: body.outcome } });
    });

    await page.goto("/issues/102");
    const section = page.getByRole("region", { name: "Ask about this issue" });
    await expect(section).toBeVisible();
    const input = section.getByLabel("Your question");
    await input.fill(QUESTION);
    await section.locator("[data-ask-run]").click();

    // The answer carries the question, the answer text, the references and the model.
    await expect(section.locator("[data-ask-answer]")).toContainText(ANSWER);
    await expect(section.locator("[data-ask-question]")).toHaveText(QUESTION);
    const meta = section.locator("[data-ask-meta]");
    await expect(meta).toContainText("openai · tiny-model");
    await expect(meta).toContainText(/min ago/);
    await expect(section.locator("[data-ask-references]")).toContainText("#100 Epic: dashboard overhaul");
    // The issue changed since the answer was stored: it is outdated and can be run again.
    expect(posted).toEqual([{ question: QUESTION }]);
    await expect(section.locator("[data-ask-outdated]")).toBeVisible();
    await expect(section.locator("[data-ask-run-again]")).toBeVisible();

    // Dismiss records the outcome and drops the answer; the form keeps the question.
    await section.locator("[data-ask-dismiss]").click();
    await expect(section.locator("[data-ask-answer]")).toHaveCount(0);
    await expect(input).toHaveValue(QUESTION);
    await expect.poll(() => outcomes.length).toBe(1);
    expect(outcomes).toEqual(["dismissed"]);

    // Asking again shows the stored answer, now for the current issue.
    await section.locator("[data-ask-run]").click();
    await expect(section.locator("[data-ask-answer]")).toContainText(ANSWER);
    await expect(section.locator("[data-ask-outdated]")).toHaveCount(0);
    expect(posted).toHaveLength(2);

    // A reference chip opens the issue inside Deska, not on GitHub.
    await section.locator("[data-ask-references] button").click();
    await expect(page).toHaveURL(/\/issues\/100$/);
    expect(page.url()).not.toContain("github.com");
  } finally {
    await context.close();
  }
});

test("Ask about this list sends only the first 200 of 213 issues and keeps the answer", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    // The list has 213 rows: the 3 fixture issues plus 210 synthetic ones.
    await writesOn(page, { extraIssues: 210 });
    let runs = 0;
    const gets: ListGet[] = [];
    const posts: ListPost[] = [];
    await page.route("**/api/ai/ask*", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        runs++;
        posts.push(request.postDataJSON() as ListPost);
        await route.fulfill({ json: { job: job("running") } });
        return;
      }
      const url = new URL(request.url());
      gets.push({
        numbers: (url.searchParams.get("numbers") ?? "").split(",").filter(Boolean).map(Number),
        total: Number(url.searchParams.get("total")),
      });
      await route.fulfill({ json: { answer: runs > 0 ? answerOf(LIST_QUESTION, LIST_ANSWER, LIST_ANSWER_HTML, [100, 101], true) : null, ai: { ready: true, reason: null } } });
    });
    await page.route("**/api/ai/jobs/*", (route) => route.fulfill({ json: { job: job("done") } }));

    await page.goto("/issues");
    const button = page.locator("[data-ask-list]");
    await expect(button).toBeEnabled();
    await expect(button).toContainText("Ask about this list");
    await button.click();
    const dialog = page.getByRole("dialog", { name: "Ask about this list" });
    await expect(dialog).toContainText("213 issues");
    // A list over 200 rows says only the first 200 were sent (SPEC §4.9, AI4).
    await expect(dialog.locator("[data-ask-limit]")).toHaveText("Only the first 200 of 213 issues are sent.");

    await dialog.getByLabel("Your question").fill(LIST_QUESTION);
    await dialog.locator("[data-ask-run]").click();
    await expect(dialog.locator("[data-ask-answer]")).toContainText(LIST_ANSWER);
    await expect(dialog.locator("[data-ask-limit]")).toBeVisible();
    expect(posts).toHaveLength(1);
    const post = posts[0]!;
    const get = gets[0]!;
    expect(post).toMatchObject({ question: LIST_QUESTION, total: 213 });
    expect(post.numbers).toHaveLength(200);
    expect(get).toMatchObject({ total: 213 });
    expect(get.numbers).toHaveLength(200);
    expect(post.numbers).toEqual(get.numbers);

    // The answer is kept for the list: closing and reopening reads it again.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await button.click();
    const reopened = page.getByRole("dialog", { name: "Ask about this list" });
    await expect(reopened.locator("[data-ask-answer]")).toContainText(LIST_ANSWER);
    await expect(reopened.locator("[data-ask-limit]")).toBeVisible();

    // A link inside the answer opens the issue inside Deska, not on GitHub: the
    // dialog steps out of the way and the side panel shows the issue.
    await reopened.locator("[data-ask-answer] a").click();
    await expect(reopened).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("issue")).toBe("101");
    expect(page.url()).not.toContain("github.com");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-side-panel]")).toHaveCount(0);

    // A reference chip does the same.
    await button.click();
    const third = page.getByRole("dialog", { name: "Ask about this list" });
    await expect(third.locator("[data-ask-answer]")).toContainText(LIST_ANSWER);
    await third.locator("[data-ask-references] button").filter({ hasText: "#100" }).click();
    await expect(third).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("issue")).toBe("100");
    expect(page.url()).not.toContain("github.com");
  } finally {
    await context.close();
  }
});

test("with AI off the list dialog says why and sends no question", async ({ browser }) => {
  const { context, page } = await as(browser);
  try {
    const reason = "AI assist is off. Choose a provider in Settings → AI.";
    const posts: string[] = [];
    await page.route("**/api/ai/ask*", async (route) => {
      if (route.request().method() === "POST") {
        posts.push("POST");
        await route.fulfill({ json: { job: job("error") } });
        return;
      }
      await route.fulfill({ json: { answer: null, ai: { ready: false, reason } } });
    });
    // With AI off and nothing stored, the issue panel stays clean.
    await page.route("**/api/issues/*/ask", (route) => route.fulfill({ json: { answer: null, ai: { ready: false, reason } } }));
    await page.goto("/issues/102");
    await expect(page.locator("[data-ask-issue]")).toHaveCount(0);

    await page.goto("/issues");
    await page.locator("[data-ask-list]").click();
    const dialog = page.getByRole("dialog", { name: "Ask about this list" });
    await expect(dialog.getByRole("alert")).toContainText(reason);
    await expect(dialog.getByRole("link", { name: "Settings → AI" })).toHaveAttribute("href", "/settings#ai");
    await expect(dialog.locator("[data-ask-run]")).toHaveCount(0);
    expect(posts).toEqual([]);
  } finally {
    await context.close();
  }
});
