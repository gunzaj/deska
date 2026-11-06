import { importFull } from "@/lib/sync/import";
import { MemoryStore } from "@/lib/sync/store-memory";
import { fixtureSnapshot } from "./fixtures";
import { demoSnapshot } from "./generate";

let demo: Promise<MemoryStore> | null = null;

/**
 * Fixture-backed store for local dev (no DATABASE_URL). The rich generated
 * dataset is the default so the UI can be reviewed realistically;
 * `DEMO_DATASET=fixtures` selects the tiny fixture set the e2e tests assert on.
 */
export function getDemoStore(): Promise<MemoryStore> {
  if (!demo) {
    const store = new MemoryStore();
    const snapshot = process.env.DEMO_DATASET === "fixtures" ? fixtureSnapshot() : demoSnapshot();
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
