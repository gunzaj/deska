import { clearStoredTokensWhenReadOnly } from "./lib/auth-tokens";
import { prepareDatabase } from "./lib/db-bootstrap";

// The embedded database must be migrated (and, until D3, seeded with demo
// data) before the first request reads it.
try {
  const { seeded } = await prepareDatabase();
  if (seeded) console.log("deska: seeded the demo dataset into an empty database");
} catch (e) {
  console.error(`deska: could not prepare the database: ${e instanceof Error ? e.message : String(e)}`);
}

// With WRITE_MODE off, no user's GitHub token stays in the database (v5 2.8).
await clearStoredTokensWhenReadOnly();
