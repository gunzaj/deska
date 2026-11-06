import { defineConfig } from "@playwright/test";

const e2eEnv = {
  DEMO_DATASET: "fixtures",
  GITHUB_REPO: "acme/widgets",
  GITHUB_ORG: "acme",
  GITHUB_PROJECT_NUMBER: "7",
  E2E_AUTH_BYPASS: "1",
  E2E_BYPASS_ACK: "i-understand",
  ALLOWED_GITHUB_LOGINS: "alice,bob",
  AUTH_SECRET: "e2e-test-secret-please-change",
  TOKEN_ENC_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

// With TEST_DATABASE_URL (CI), a second project runs the smoke and task specs
// against the production path: Postgres → getStore → the APIs (S11). Its
// server seeds the database in the global setup (tests/e2e/warmup.ts), which
// TRUNCATEs every table first: never point TEST_DATABASE_URL at real data.
const pg = process.env.TEST_DATABASE_URL?.trim() || null;
const PG_PORT = 3101;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/warmup.ts",
  // `next dev` compiles a route on its first request: a cold page can take a
  // while, so a generous per-test timeout instead of the 30 s default.
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { trace: "on-first-retry" },
  projects: [
    { name: "mocks", use: { baseURL: "http://localhost:3100" } },
    ...(pg
      ? [
          {
            name: "e2e-postgres",
            testMatch: /(smoke|tasks)\.spec\.ts/,
            use: { baseURL: `http://localhost:${PG_PORT}` },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: "pnpm dev --port 3100",
      url: "http://localhost:3100/signin",
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...e2eEnv,
        PORT: "3100",
        // Mocked e2e runs on demo fixtures. Next loads .env, so unset DATABASE_URL
        // must be forced empty here or a local .env sends the pages to Postgres.
        DATABASE_URL: "",
      },
    },
    ...(pg
      ? [
          {
            command: `pnpm dev --port ${PG_PORT}`,
            url: `http://localhost:${PG_PORT}/signin`,
            timeout: 180_000,
            reuseExistingServer: !process.env.CI,
            env: { ...e2eEnv, PORT: String(PG_PORT), DATABASE_URL: pg, NEXT_DIST_DIR: ".next-e2e" },
          },
        ]
      : []),
  ],
});
