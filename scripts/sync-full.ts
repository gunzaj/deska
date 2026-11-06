// pnpm sync:full — full import from fixtures (default) or a live read-only
// GitHub snapshot (--live, needs GITHUB_TOKEN). With --db (or DATABASE_URL
// set) it imports into the shared Postgres cache so the app can render it;
// otherwise it imports into a throwaway in-memory store and prints counts.
// A re-import of the same snapshot must be a no-op (idempotency asserted).
import { databaseUrl } from "../db";
import { MemoryStore } from "../lib/sync/store-memory";
import { PostgresStore } from "../lib/sync/store-postgres";
import { fetchLiveSnapshot } from "../lib/sync/live";
import { fixtureSnapshot } from "../lib/demo/fixtures";
import { SYNC_FULL_LOCK_WAIT_MS, syncFull } from "../lib/sync/initial";

async function main() {
  const live = process.argv.includes("--live");
  const useDb = process.argv.includes("--db") || !!databaseUrl();
  if (live && !process.env.GITHUB_TOKEN) {
    console.error("sync:full --live needs GITHUB_TOKEN (read-only).");
    process.exit(1);
  }
  const snapshot = live
    ? await fetchLiveSnapshot(process.env.GITHUB_TOKEN ?? "")
    : fixtureSnapshot();
  const store = useDb ? new PostgresStore() : new MemoryStore();
  // One sync at a time (lib/sync/lock.ts): wait for a running cron, worker or
  // "Sync now" cycle to finish, but give up after 10 minutes. The import also
  // seeds the sync cursors, so the cron can take over from here (S2).
  const locked = await syncFull(snapshot, store);
  if (!locked.ran) {
    console.error(`sync:full: another sync still held the lock after ${SYNC_FULL_LOCK_WAIT_MS / 60_000} min; giving up.`);
    process.exit(1);
  }
  const { first, second } = locked.value;
  console.log(`mode: ${live ? "live" : "fixtures"}${useDb ? " -> postgres" : " -> memory"}`);
  console.log(`first run:  ${JSON.stringify(first)}`);
  console.log(`second run: ${JSON.stringify(second)}`);
  if (store instanceof MemoryStore) {
    console.log(
      `rows: issues=${store.issueCount} fields=${store.fields.size} types=${store.issueTypes.size} labels=${store.labels.size} items=${store.projectItems.size} prs=${store.pullRequests.size}`,
    );
  }
  if (second.inserted !== 0 || second.updated !== 0) {
    console.error("NOT IDEMPOTENT");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
