import { prepareDatabase } from "./lib/db-bootstrap";
import { installLogRedaction } from "./lib/redact";

// No log line from this server ever carries the GitHub token (SPEC §2.3).
installLogRedaction();

// The embedded database must be migrated (and, until in-process sync lands in
// D5, seeded with demo data when asked to) before the first request reads it.
try {
  const { seeded } = await prepareDatabase();
  if (seeded) console.log("deska: seeded the demo dataset into an empty database");
} catch (e) {
  console.error(`deska: could not prepare the database: ${e instanceof Error ? e.message : String(e)}`);
}
