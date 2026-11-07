import { prepareDatabase } from "./lib/db-bootstrap";
import { installLogRedaction } from "./lib/redact";
import { syncService } from "./lib/sync/service";

// No log line from this server ever carries the GitHub token (SPEC §2.3).
installLogRedaction();

// The embedded database must be migrated (and, for tests, dev and the
// preview, seeded with sample data when asked to) before the first request
// reads it.
let ready = false;
try {
  const { seeded } = await prepareDatabase();
  if (seeded) console.log("deska: seeded the sample dataset into an empty database");
  ready = true;
} catch (e) {
  console.error(`deska: could not prepare the database: ${e instanceof Error ? e.message : String(e)}`);
}

// The desktop app syncs in this process while it runs (SPEC D5): a run now,
// then on an interval, on wake and on "Sync now".
if (ready && process.env.DESKA_DESKTOP === "1") syncService().start();
