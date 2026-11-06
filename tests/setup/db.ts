// Database tests run on a throwaway in-memory PGlite (SPEC D2: no Docker). One
// database per test process; the files still truncate the tables they use.
import { beforeAll } from "vitest";

process.env.DESKA_DB_DIR = "memory://";

beforeAll(async () => {
  const { ensureMigrated } = await import("@/db");
  await ensureMigrated();
});
