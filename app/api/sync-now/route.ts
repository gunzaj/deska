import { NextResponse } from "next/server";
import { databaseUrl } from "@/db";
import { route } from "@/lib/server/route";
import { GitHubSource } from "@/lib/sync/source-github";
import { PostgresStore } from "@/lib/sync/store-postgres";
import { redactError } from "@/lib/sync/health";
import { currentFieldMap } from "@/lib/sync/runtime";
import { triggerSync } from "@/lib/sync/trigger";
import { invalidateReadCache } from "@/lib/store";
import { drainLeftovers } from "@/lib/outbox/runtime";
import { fireReminders } from "@/lib/tasks/notify";

// A cycle (poll + a due project scan) must finish inside one invocation. 60 s
// is the Hobby ceiling and well inside Pro's; raise it on Pro if scans of a
// large project get cut off.
export const maxDuration = 60;

/**
 * One issue change-check cycle against live GitHub, written to the shared
 * Postgres cache. Previously this filled a process-local MemoryStore that no
 * other process could read, so the sync never reached the UI.
 *
 * Only one cycle runs at a time across the cron, the worker and every
 * instance (lib/sync/lock.ts). A skipped cycle is a 200 with `skipped`, not an
 * error: the UI shows "Sync already running" or "Synced just now".
 */
async function runSync(manual: boolean) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "GITHUB_TOKEN not configured" }, { status: 503 });
  }
  if (!databaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL not configured — nothing to sync into" },
      { status: 503 },
    );
  }
  const store = new PostgresStore();
  try {
    // Inside the try: reading sync_state is the first DB call, and a database
    // outage used to escape as an unhandled 500 instead of this JSON error.
    const out = await triggerSync(new GitHubSource(token, store, await currentFieldMap(store)), store, { manual });
    if (out.kind === "skipped") return NextResponse.json({ skipped: out.skipped, lastSync: out.lastSync });
    // No cursor yet: the poll refused to page the whole repo history (S2).
    if (!out.result.issues.applied && out.result.issues.reason === "needs-initial-import") {
      return NextResponse.json({ error: "needs initial import", hint: "run pnpm sync:full --live --db" }, { status: 503 });
    }
    // Other instances share the DB, not this process's memory.
    invalidateReadCache();
    return NextResponse.json({ ...out.result, source: "postgres" });
  } catch (e) {
    // The detail (SQL text, hostnames) goes to the log and to the status chip's
    // lastError, not to whoever pressed the button (v5 2.9).
    console.error(`sync failed: ${redactError(e)}`);
    return NextResponse.json({ error: "sync failed" }, { status: 502 });
  }
}

// POST = "Sync now" button (session-gated, throttled); GET = Vercel Cron
// (CRON_SECRET). "Sync now" rescans the project when the last scan is over a
// minute old, so a field just changed on GitHub shows up; the cron scans only
// when the interval is due.
//
// Middleware normally guards both, but the button triggers a full cycle with
// the shared token, so the wrapper refuses an anonymous caller here too.
export const POST = route({ auth: "viewer" }, () => runSync(true));

/** The cron stops starting outbox rows this long into the route (maxDuration is 60 s). */
const DRAIN_BUDGET_MS = 40_000;

export const GET = route({ auth: "cron" }, async () => {
  const startedAt = Date.now();
  // The cron also fires task reminders for everyone (SPEC §12.6). Tasks don't
  // depend on GitHub, so this runs even when the sync itself can't.
  if (databaseUrl()) await fireReminders().catch((e) => console.error(`reminders failed: ${String(e)}`));
  // The sync goes first: a drain ahead of it used to eat the invocation and cut
  // the sync off on every tick (v5 2.3).
  const res = await runSync(false);
  // Edits whose request ended before they were written (W1); no-op while
  // writes are off. Best-effort: it stops starting rows once the budget is
  // spent, and the worker (which drains every round) picks up the rest.
  if (databaseUrl()) {
    await drainLeftovers(process.env.STATUS_DONE_OPTION_ID ?? "", { deadline: startedAt + DRAIN_BUDGET_MS }).catch((e) =>
      console.error(`outbox drain failed: ${redactError(e)}`),
    );
  }
  return res;
});
