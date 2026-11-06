import { NextResponse } from "next/server";
import { dbDir } from "@/db";
import { localToken } from "@/lib/github/local-token";
import { route } from "@/lib/server/route";
import { currentTarget } from "@/lib/settings";
import { GitHubSource } from "@/lib/sync/source-github";
import { PostgresStore } from "@/lib/sync/store-postgres";
import { redactError } from "@/lib/sync/health";
import { currentFieldMap } from "@/lib/sync/runtime";
import { triggerSync } from "@/lib/sync/trigger";
import { invalidateReadCache } from "@/lib/store";

/**
 * "Sync now": one issue change-check cycle against GitHub with the local
 * user's token, written to the local cache. Only one cycle runs at a time
 * (lib/sync/lock.ts). A skipped cycle is a 200 with `skipped`, not an error:
 * the UI shows "Sync already running" or "Synced just now". "Sync now"
 * rescans the project when the last scan is over a minute old, so a field
 * just changed on GitHub shows up.
 */
export const POST = route({ auth: "viewer" }, async () => {
  const token = localToken();
  if (!token) return NextResponse.json({ error: "GitHub is not connected" }, { status: 503 });
  if (!dbDir()) {
    return NextResponse.json({ error: "DESKA_DB_DIR not configured — nothing to sync into" }, { status: 503 });
  }
  const store = new PostgresStore();
  try {
    // Inside the try: reading sync_state is the first DB call, and a database
    // outage used to escape as an unhandled 500 instead of this JSON error.
    const target = await currentTarget();
    if (!target) return NextResponse.json({ error: "Choose a repository and project first" }, { status: 409 });
    const out = await triggerSync(new GitHubSource(token, store, await currentFieldMap(store), target), store, { manual: true });
    if (out.kind === "skipped") return NextResponse.json({ skipped: out.skipped, lastSync: out.lastSync });
    // No cursor yet: the poll refused to page the whole repo history (S2).
    if (!out.result.issues.applied && out.result.issues.reason === "needs-initial-import") {
      return NextResponse.json({ error: "needs initial import", hint: "run pnpm sync:full --live --db" }, { status: 503 });
    }
    invalidateReadCache();
    return NextResponse.json({ ...out.result, source: "postgres" });
  } catch (e) {
    // The detail (SQL text, hostnames) goes to the log and to the status chip's
    // lastError, not to whoever pressed the button (v5 2.9).
    console.error(`sync failed: ${redactError(e)}`);
    return NextResponse.json({ error: "sync failed" }, { status: 502 });
  }
});
