// pnpm worker — incremental polling loop (SPEC §3).
// Needs GITHUB_TOKEN (read-only) and DATABASE_URL. Both the issue change check
// and the project scan write to the shared Postgres cache that the web
// app reads, so this process and the app finally agree on the data.
import { databaseUrl, getDb } from "../db";
import { clearStoredTokensWhenReadOnly } from "../lib/auth-tokens";
import { issues } from "../db/schema";
import { recordCycle, redactError } from "../lib/sync/health";
import { initialImport } from "../lib/sync/initial";
import { GitHubSource } from "../lib/sync/source-github";
import { PostgresStore } from "../lib/sync/store-postgres";
import { fetchLiveSnapshot, githubReconcileSource } from "../lib/sync/live";
import { runNightly } from "../lib/sync/nightly";
import { drainLeftovers } from "../lib/outbox/runtime";
import { runSyncCycle } from "../lib/sync/cycle";
import { fireReminders } from "../lib/tasks/notify";
import type { Kv } from "../lib/sync/poll";
import { currentFieldMap, withLockedSyncKv } from "../lib/sync/runtime";

const ISSUES_MS = Number(process.env.SYNC_ISSUES_MS ?? 90_000);

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("deska worker: GITHUB_TOKEN not set — refusing to run without credentials.");
    process.exitCode = 1;
    return;
  }
  if (!databaseUrl()) {
    console.error("deska worker: DATABASE_URL not set — the sync would be written nowhere.");
    process.exitCode = 1;
    return;
  }

  await clearStoredTokensWhenReadOnly();
  const store = new PostgresStore();
  const fieldMap = await currentFieldMap(store);
  const source = new GitHubSource(token, store, fieldMap);
  const nightlySource = githubReconcileSource(token, store, fieldMap);

  // First run against an empty cache: do the bounded initial import (metadata,
  // labels, milestones, users, the issue window and all project items) so the
  // board has columns and the lists have names. Later runs are incremental.
  // One row is enough to tell; hydrating the whole cache just to count it was not.
  const existing = await getDb().select({ id: issues.id }).from(issues).limit(1);
  let needsInitialImport = existing.length === 0;

  console.log(`deska worker: issues every ${ISSUES_MS}ms, project scan when due`);

  for (;;) {
    // One locked unit per loop: initial import, or poll + PR scan + project
    // scan. The cron or "Sync now" in another process may hold the lock; then
    // this round is skipped. Cursors live in sync_state, shared with the web
    // app, and are re-read once the lock is held.
    try {
      const locked = await withLockedSyncKv(async (kv) => {
        // Until the initial import succeeds there is no `issues.since`, and a
        // poll without it would crawl the repo's entire issue history (pollOnce
        // refuses to). A cache filled without seeding the cursors gets the
        // same import; it is idempotent. Retry until it works.
        if (needsInitialImport || !kv.get("issues.since")) {
          needsInitialImport = !(await runInitialImport(token, store, kv));
          return;
        }
        // One JSON log line and the sync health keys per cycle (S3). A failed
        // step does not stop the others (continueOnError), but marks the cycle
        // failed. It is the same cycle the cron and "Sync now" run (v5 4.3).
        const result = await recordCycle(kv, () => runSyncCycle(source, store, kv, { continueOnError: true }), {
          failure: (r) => (r.errors.length ? r.errors.join("; ") : null),
        });
        // The cursor went missing under us: import again next round.
        if (!result.issues.applied && result.issues.reason === "needs-initial-import") needsInitialImport = true;
        // Once a day: the nightly reconcile (S6). Its failure must not stop the loop.
        try {
          await runNightly(nightlySource, store, kv);
        } catch (e) {
          console.error(`reconcile failed: ${redactError(e)}`);
        }
      });
      if (!locked.ran) console.log("deska worker: another sync is running, skipping this round");
    } catch (e) {
      // Taking the lock needs the database; an outage must not kill the worker.
      console.error(`sync round failed: ${redactError(e)}`);
    }

    // Edits whose request ended before they were written (W1); no-op while
    // writes are off.
    try {
      const drained = await drainLeftovers(process.env.STATUS_DONE_OPTION_ID ?? "");
      if (drained) console.log(`outbox: drained ${drained} edit(s)`);
    } catch (e) {
      console.error(`outbox drain failed: ${redactError(e)}`);
    }

    // Task reminders for everyone (SPEC §12.6); clients also fire their own.
    // Not sync work, so outside the lock.
    try {
      const fired = await fireReminders();
      if (fired) console.log(`reminders fired: ${fired}`);
    } catch (e) {
      console.error(`reminders failed: ${String(e)}`);
    }
    await sleep(ISSUES_MS);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bounded initial import into an empty cache. Returns whether it succeeded. */
async function runInitialImport(token: string, store: PostgresStore, kv: Kv): Promise<boolean> {
  console.log("deska worker: no sync cursor yet — running initial full import");
  try {
    await recordCycle(kv, async () => ({ initial: await initialImport(await fetchLiveSnapshot(token), store, kv) }));
    return true;
  } catch (e) {
    console.error(`initial import failed, retrying next cycle: ${redactError(e)}`);
    return false;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});