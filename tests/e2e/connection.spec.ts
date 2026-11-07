import { expect, test, type Page } from "@playwright/test";
import { as } from "./helpers";

// D3: onboarding, Settings and the token states of SPEC §3.3 in the UI. The
// e2e server is a preview without a token, so the desktop bridge is a fake in
// the page and /api/connection answers come from the test. The server-side
// checks against mocked GitHub are in tests/github/connection.test.ts; the
// real desktop flow is in tests/electron/smoke.spec.ts.

// Obviously fake; assembled so no token-shaped literal is committed.
const TOKEN = ["github", "pat", "TEST", "FAKE", "0".repeat(24)].join("_");

const PERMISSIONS = [
  { key: "metadata", label: "Repository → Metadata", level: "Read", required: true },
  { key: "issues", label: "Repository → Issues", level: "Read", required: true },
  { key: "projects", label: "Organization → Projects", level: "Read", required: true },
  { key: "issueTypes", label: "Organization → Issue types", level: "Read", required: false },
];

function status(over: Record<string, unknown> = {}, perms: Record<string, string> = {}) {
  return {
    state: "ok",
    message: null,
    login: "alice",
    name: null,
    avatarUrl: null,
    expiresAt: "2027-03-01T00:00:00.000Z",
    expiryWarning: null,
    readOnly: true,
    readOnlyMessage: "Read-only token",
    permissions: PERMISSIONS.map((p) => ({ ...p, status: perms[p.key] ?? "granted", detail: null })),
    missing: [],
    rateLimitedUntil: null,
    checkedAt: "2026-11-06T09:00:00.000Z",
    ...over,
  };
}

/** Answers /api/connection with `next()` (called per request). */
async function connection(page: Page, next: (refresh: boolean) => unknown) {
  await page.route("**/api/connection*", (route) => route.fulfill({ json: next(new URL(route.request().url()).searchParams.get("refresh") === "1") }));
}

/** A fake preload bridge; what the page hands it is recorded here, across navigations. */
async function fakeBridge(page: Page) {
  const calls = { set: [] as string[], clear: 0 };
  await page.exposeFunction("__bridgeSet", (t: string) => void calls.set.push(t));
  await page.exposeFunction("__bridgeClear", () => void calls.clear++);
  await page.addInitScript(() => {
    const w = window as unknown as { deska: unknown; __bridgeSet(t: string): Promise<void>; __bridgeClear(): Promise<void> };
    const ok = { stored: true, encryptionAvailable: true };
    w.deska = {
      appInfo: async () => ({ name: "Deska", version: "1.0.0", platform: "darwin" }),
      openExternal: async () => true,
      notify: async () => undefined,
      token: {
        set: async (t: string) => {
          if (!t.startsWith("github_pat_")) throw new Error("Error invoking remote method 'deska:token-set': Error: Deska needs a fine-grained personal access token. It starts with github_pat_.");
          await w.__bridgeSet(t);
          return ok;
        },
        clear: async () => {
          await w.__bridgeClear();
          return { stored: false, encryptionAvailable: true };
        },
        status: async () => ok,
      },
    };
  });
  return async () => calls;
}

test("without a local user the app opens onboarding; the preview says tokens need the desktop app", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Connect GitHub" })).toBeVisible();
  await expect(page.getByText("Token entry is only available in the Deska desktop app")).toBeVisible();
  // The guide lists the read permissions of SPEC §3.2.
  for (const p of ["Repository → Metadata", "Repository → Issues", "Organization → Projects", "Organization → Issue types"]) {
    await expect(page.getByRole("cell", { name: p })).toBeVisible();
  }
});

test("onboarding: paste a token → bridge → check → read-only token reaches the issue list", async ({ browser }) => {
  const { context, page } = await as(browser);
  const calls = await fakeBridge(page);
  let connected = false;
  await connection(page, (refresh) => {
    if (refresh) connected = true;
    return connected ? status() : status({ state: "missing", message: "Connect GitHub to get started", login: null, readOnly: false, readOnlyMessage: null }, { metadata: "unchecked", issues: "unchecked", projects: "unchecked", issueTypes: "unchecked" });
  });
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "How to create it" })).toBeVisible();

  // A classic token is refused by main with its own words.
  await page.getByLabel("Fine-grained personal access token").fill("ghp_notfinegrained");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Deska needs a fine-grained personal access token. It starts with github_pat_.")).toBeVisible();

  await page.getByLabel("Fine-grained personal access token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Connected as")).toContainText("@alice");
  await expect(page.getByText("Read-only token")).toBeVisible();
  expect((await calls()).set).toEqual([TOKEN]);
  // The token is gone from the page once handed over.
  expect(await page.content()).not.toContain(TOKEN);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie)).not.toContain(TOKEN);

  await page.getByRole("button", { name: "Continue" }).click();
  // Step 2 (D4): choosing a project needs the server to hold the token, which
  // only the desktop app does (tests/electron covers it); here it says so.
  await expect(page.getByRole("heading", { name: "Choose your project" })).toBeVisible();
  await expect(page.getByText("Choosing a project needs a connected token")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/issues$/);
  await expect(page.getByText("Bug: crash on start")).toBeVisible({ timeout: 20_000 });
  await context.close();
});

test("onboarding: an invalid token gets its message and is deleted again", async ({ browser }) => {
  const { context, page } = await as(browser);
  const calls = await fakeBridge(page);
  await connection(page, (refresh) =>
    refresh
      ? status({ state: "invalid", message: "Your GitHub token is invalid or expired", login: null, readOnly: false, readOnlyMessage: null })
      : status({ state: "missing", message: "Connect GitHub to get started", login: null }),
  );
  await page.goto("/onboarding");
  await page.getByLabel("Fine-grained personal access token").fill(TOKEN);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Your GitHub token is invalid or expired")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  expect((await calls()).clear).toBe(1);
  await context.close();
});

const STATES: [string, Record<string, unknown>, string][] = [
  ["invalid", { state: "invalid", message: "Your GitHub token is invalid or expired" }, "Your GitHub token is invalid or expired"],
  ["expiring soon", { expiryWarning: "Your GitHub token expires on 2026-11-15", expiresAt: "2026-11-15T10:00:00.000Z" }, "Your GitHub token expires on 2026-11-15"],
  ["awaiting approval", { state: "awaiting-approval", message: "Your org may still need to approve this token" }, "Your org may still need to approve this token"],
  [
    "missing a permission",
    { state: "missing-permission", message: "This token is missing a permission: Organization → Projects: Read", missing: ["Organization → Projects: Read"] },
    "Organization → Projects: Read",
  ],
  ["offline", { state: "offline", message: "Can't reach GitHub" }, "Can't reach GitHub"],
  ["rate limited", { state: "rate-limited", message: "Rate limited until 09:42", rateLimitedUntil: "2026-11-06T09:42:00.000Z" }, "Rate limited until 09:42"],
];

test("each token state shows its own message over the app", async ({ browser }) => {
  const { context, page } = await as(browser);
  let current: Record<string, unknown> = {};
  await connection(page, () => status(current));
  for (const [name, over, text] of STATES) {
    current = over;
    await page.goto("/issues");
    const banner = page.locator("[data-connection-state]");
    await expect(banner, name).toContainText(text, { timeout: 20_000 });
    // Cached data stays visible under the banner.
    await expect(page.getByText("Bug: crash on start")).toBeVisible();
  }
  // Read-only: no banner; edit controls say why they are off (the preview has no token).
  current = {};
  await page.goto("/issues");
  await expect(page.getByText("Bug: crash on start")).toBeVisible();
  await expect(page.locator("[data-connection-state]")).toHaveCount(0);
  await context.close();
});

test("a token missing Projects read names the permission, never an empty list", async ({ browser }) => {
  const { context, page } = await as(browser);
  await connection(page, () =>
    status({ state: "missing-permission", message: "This token is missing a permission: Organization → Projects: Read", missing: ["Organization → Projects: Read"] }, { projects: "missing" }),
  );
  // Nothing cached yet: the list would be empty.
  await page.route("**/api/data", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    const res = await route.fetch({ headers });
    const json = await res.json();
    json.issues = [];
    await route.fulfill({ response: res, json, headers: { ...res.headers(), etag: "" } });
  });
  await page.goto("/issues");
  const main = page.getByRole("main");
  await expect(main.getByText("This token is missing a permission: Organization → Projects: Read").last()).toBeVisible({ timeout: 20_000 });
  await expect(main.getByRole("link", { name: "Open Settings" })).toBeVisible();
  await expect(page.getByText("No issues here")).toHaveCount(0);
  await context.close();
});

test("Settings shows the owner, permissions, expiry and read-only status; disconnect deletes the token", async ({ browser }) => {
  const { context, page } = await as(browser);
  const calls = await fakeBridge(page);
  await connection(page, () => status({ name: "Alice" }, { issueTypes: "unavailable" }));
  await page.goto("/settings");
  await expect(page.getByText("Connected as")).toContainText("@alice");
  await expect(page.getByText("2027-03-01")).toBeVisible();
  await expect(page.getByText("Read-only token")).toBeVisible();
  const perms = page.getByRole("list", { name: "Detected permissions" });
  await expect(perms.locator('[data-permission="projects"]')).toContainText("Granted");
  await expect(perms.locator('[data-permission="issueTypes"]')).toContainText("Not granted (optional)");
  await expect(page.getByRole("heading", { name: "Replace token" })).toBeVisible();

  await page.getByRole("button", { name: "Disconnect GitHub…" }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  expect((await calls()).clear).toBe(1);
  await context.close();
});
