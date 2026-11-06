import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { fixtureSnapshot } from "./fixtures";
import { altFixtureSnapshot } from "./fixtures-alt";
import { demoSnapshot } from "./generate";

let demo: Promise<MemoryStore> | null = null;

/**
 * Fixture-backed store for local dev (no DESKA_DB_DIR). The rich generated
 * dataset is the default so the UI can be reviewed realistically;
 * `DEMO_DATASET=fixtures` selects the tiny fixture set the e2e tests assert on.
 */
export function getDemoStore(): Promise<MemoryStore> {
  if (!demo) {
    const store = new MemoryStore();
    const set = process.env.DEMO_DATASET;
    const snapshot = set === "fixtures" ? fixtureSnapshot() : set === "alt" || set === "alt-no-sprint" ? altFixtureSnapshot({ sprint: set === "alt" }) : demoSnapshot();
    // Forget a failed import so the next request retries instead of
    // rethrowing the same rejection for the life of the process.
    demo = importFull(snapshot, store).then(
      () => store,
      (e: unknown) => {
        demo = null;
        throw e;
      },
    );
  }
  return demo;
}
