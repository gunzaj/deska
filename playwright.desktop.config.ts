import { defineConfig } from "@playwright/test";

// The desktop smoke test (SPEC D2): launches the built app with Playwright's
// Electron driver. Needs `pnpm desktop:build` (the packaged app in release/)
// or `pnpm desktop:stage` (runs `electron .` on the staged build).
export default defineConfig({
  testDir: "tests/electron",
  timeout: 180_000,
  // One app per profile; the specs launch and quit it themselves.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "retain-on-failure" },
});
