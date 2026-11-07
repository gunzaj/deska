import { installLogRedaction } from "./lib/redact";
import { openDatabase, startDesktopServices } from "./lib/desktop/startup";

// No log line from this server ever carries the GitHub token (SPEC §2.3).
installLogRedaction();

// The embedded database must be migrated (and, for tests, dev and the
// preview, seeded with sample data when asked to) before the first request
// reads it. A database that will not open is noted, not fatal: the desktop
// shell asks the user to restore a backup before it opens the window (D8).
const ready = await openDatabase();

// The desktop app syncs in this process while it runs (SPEC D5), and takes a
// daily backup (D8).
if (ready && process.env.DESKA_DESKTOP === "1") startDesktopServices();
