import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // Unit tests assert on the small fixture set, not the rich demo dataset.
    env: {
      DEMO_DATASET: "fixtures",
      // The GitHub target has no defaults (v5 1.2); tests run against these.
      GITHUB_REPO: "acme/widgets",
      GITHUB_ORG: "acme",
      GITHUB_PROJECT_NUMBER: "7",
    },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/**/*.test.ts"], exclude: ["tests/**/*.pg.test.ts"] },
      },
      {
        // Postgres integration tests (skipped without TEST_DATABASE_URL) share
        // one database and truncate tables, so their files run one at a time.
        extends: true,
        test: {
          name: "postgres",
          include: ["tests/**/*.pg.test.ts"],
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
