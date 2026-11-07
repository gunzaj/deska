import { NextResponse } from "next/server";
import { MESSAGES } from "@/lib/github/token-states";
import { route } from "@/lib/server/route";
import { syncService } from "@/lib/sync/service";

/**
 * "Sync now": one run of the in-process sync service (lib/sync/service.ts)
 * with the local user's token: the first import while the cache has none, else
 * a cycle that rescans the project when the last scan is over a minute old, so
 * a field just changed on GitHub shows up. Only one run at a time. A skipped
 * run is a 200 with `skipped`, not an error: the UI shows "Sync already
 * running" or "Synced just now".
 */
export const POST = route({ auth: "viewer" }, async () => {
  const out = await syncService().request("manual");
  switch (out.kind) {
    case "idle":
      if (out.reason === "no-token") return NextResponse.json({ error: "GitHub is not connected" }, { status: 503 });
      if (out.reason === "no-project") return NextResponse.json({ error: "Choose a repository and project first" }, { status: 409 });
      if (out.reason === "no-database") return NextResponse.json({ error: "DESKA_DB_DIR not configured — nothing to sync into" }, { status: 503 });
      // Sample data is never synced; quitting: nothing to do.
      return NextResponse.json({ skipped: out.reason, lastSync: null });
    case "skipped":
      return NextResponse.json({ skipped: out.skipped, lastSync: out.lastSync });
    case "failed":
      // The detail (SQL text, hostnames) goes to the log and to the status
      // chip's lastError; the button gets the §3.3 words (v5 2.9).
      return NextResponse.json(
        { error: out.failure === "invalid" ? MESSAGES.invalid : out.failure === "offline" ? MESSAGES.offline : "sync failed", failure: out.failure },
        { status: 502 },
      );
    case "imported":
      return NextResponse.json({ imported: out.result, source: "postgres" });
    case "ran":
      return NextResponse.json({ ...out.result, nightly: out.nightly?.ran ?? false, source: "postgres" });
  }
});
