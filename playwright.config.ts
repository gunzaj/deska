import { defineConfig } from "@playwright/test";

const e2eEnv = {
  DEMO_DATASET: "fixtures",
  GITHUB_REPO: "acme/widgets",
  GITHUB_ORG: "acme",
  GITHUB_PROJECT_NUMBER: "7",
  E2E_AUTH_BYPASS: "1",
  E2E_BYPASS_ACK: "i-understand",
};

// A second project runs the smoke, task and local-data specs against the database path:
// PGlite → getStore → the APIs (S11). Its server keeps an in-memory database
// that it migrates and seeds with the fixtures when it starts
// (instrumentation-node.ts), so every run starts from the same data.
const DB_PORT = 3101;

// Specs that change settings the whole server shares ("My default" scope, time
// zone, start page, Home layout, AI settings, theme) get their own server and run one at a time
// (issue #6). On the shared server, the files run in parallel workers, and one
// spec's "My default" emptied another spec's issue list mid-test.
const SETTINGS_PORT = 3102;
const SHARED_SETTINGS = /(ai-settings|user-menu|filters|release-team|settings-timezone|home-settings|calendar-home)\.spec\.ts/;

// `E2E_PROJECT=mocks pnpm test:e2e` runs one project and starts only its
// server (each server below carries its project's name). A warmed `next dev`
// holds about 4 GB and the mocked one grows to 7 GB while the specs run: the
// three together filled a 16 GB CI runner, which then died without a message.
// CI runs the projects one after another (ci.yml); a local run without the
// variable runs everything together, as before.
const PROJECTS = ["mocks", "mocks-settings", "e2e-db"];
const ONLY = process.env.E2E_PROJECT;
if (ONLY && !PROJECTS.includes(ONLY)) throw new Error(`E2E_PROJECT=${ONLY}: expected one of ${PROJECTS.join(", ")}`);
const wanted = (x: { name?: string }) => !ONLY || x.name === ONLY;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/warmup.ts",
  // `next dev` compiles a route on its first request: a cold page can take a
  // while, so a generous per-test timeout instead of the 30 s default.
  timeout: 120_000,
  // The dev servers compile a route on its first request: under a loaded CI
  // runner a page can take longer than the default 5 s to show its data.
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  // CI keeps the list too, so its log names each spec with its time. Each
  // project's run keeps its own report and traces.
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never", outputFolder: ONLY ? `playwright-report/${ONLY}` : "playwright-report" }]] : "list",
  outputDir: ONLY ? `test-results/${ONLY}` : "test-results",
  use: { trace: "on-first-retry" },
  projects: [
    // local-data needs a database: it runs in e2e-db only.
    { name: "mocks", testIgnore: [/local-data\.spec\.ts/, SHARED_SETTINGS], use: { baseURL: "http://localhost:3100" } },
    { name: "mocks-settings", testMatch: SHARED_SETTINGS, workers: 1, use: { baseURL: `http://localhost:${SETTINGS_PORT}` } },
    {
      name: "e2e-db",
      testMatch: /(smoke|tasks|local-data)\.spec\.ts/,
      use: { baseURL: `http://localhost:${DB_PORT}` },
    },
  ].filter(wanted),
  webServer: [
    {
      name: "mocks",
      command: "pnpm dev --port 3100",
      url: "http://localhost:3100/onboarding",
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...e2eEnv,
        PORT: "3100",
        // Mocked e2e runs on demo fixtures. Next loads .env, so an unset
        // DESKA_DB_DIR must be forced empty here or a local .env sends the pages
        // to a database.
        DESKA_DB_DIR: "",
      },
    },
    {
      name: "e2e-db",
      command: `pnpm dev --port ${DB_PORT}`,
      url: `http://localhost:${DB_PORT}/onboarding`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { ...e2eEnv, PORT: String(DB_PORT), DESKA_DB_DIR: "memory://", DESKA_DEMO_SEED: "fixtures", NEXT_DIST_DIR: ".next-e2e" },
    },
    {
      name: "mocks-settings",
      command: `pnpm dev --port ${SETTINGS_PORT}`,
      url: `http://localhost:${SETTINGS_PORT}/onboarding`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { ...e2eEnv, PORT: String(SETTINGS_PORT), DESKA_DB_DIR: "", NEXT_DIST_DIR: ".next-e2e-settings" },
    },
  ].filter(wanted),
});
