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
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { trace: "on-first-retry" },
  projects: [
    // local-data needs a database: it runs in e2e-db only.
    { name: "mocks", testIgnore: /local-data\.spec\.ts/, use: { baseURL: "http://localhost:3100" } },
    {
      name: "e2e-db",
      testMatch: /(smoke|tasks|local-data)\.spec\.ts/,
      use: { baseURL: `http://localhost:${DB_PORT}` },
    },
  ],
  webServer: [
    {
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
      command: `pnpm dev --port ${DB_PORT}`,
      url: `http://localhost:${DB_PORT}/onboarding`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { ...e2eEnv, PORT: String(DB_PORT), DESKA_DB_DIR: "memory://", DESKA_DEMO_SEED: "fixtures", NEXT_DIST_DIR: ".next-e2e" },
    },
  ],
});
