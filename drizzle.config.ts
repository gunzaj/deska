import { defineConfig } from "drizzle-kit";

// Migrations are generated from db/schema.ts and applied by the app itself on
// start (db/index.ts ensureMigrated). The credentials are only for drizzle-kit
// tools such as `studio` against a local PGlite directory.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  driver: "pglite",
  dbCredentials: {
    url: process.env.DESKA_DB_DIR ?? ".deska-db",
  },
});
