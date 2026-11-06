// Opens the local database when the server starts (instrumentation-node.ts):
// applies pending migrations and, until in-process sync lands (D5), seeds the
// fictional demo dataset into an empty database when DESKA_DEMO_SEED asks for
// it, so the app has something to show.
import { sql } from "drizzle-orm";
import { dbDir, ensureMigrated, getDb } from "@/db";
import { demoSnapshot } from "./demo/generate";
import { fixtureSnapshot } from "./demo/fixtures";
import { initialImport } from "./sync/initial";
import { withLockedSyncKv } from "./sync/runtime";
import { PostgresStore } from "./sync/store-postgres";

export type DemoSeed = "demo" | "fixtures";

/** `DESKA_DEMO_SEED`: `demo` (the rich dataset) or `fixtures` (the small test set). */
export function demoSeed(env: Record<string, string | undefined> = process.env): DemoSeed | null {
  const v = env.DESKA_DEMO_SEED?.trim();
  return v === "demo" || v === "fixtures" ? v : null;
}

/** Migrate, then seed demo data into an empty cache if asked to. */
export async function prepareDatabase(): Promise<{ seeded: boolean }> {
  if (!dbDir()) return { seeded: false };
  await ensureMigrated();
  const seed = demoSeed();
  if (!seed) return { seeded: false };
  const { rows } = await getDb().execute(sql`SELECT count(*)::int AS n FROM issues`);
  if (Number((rows[0] as { n: number } | undefined)?.n ?? 0) > 0) return { seeded: false };
  const snapshot = seed === "fixtures" ? fixtureSnapshot() : demoSnapshot();
  const res = await withLockedSyncKv((kv) => initialImport(snapshot, new PostgresStore(), kv), { waitMs: 60_000, retryMs: 500 });
  return { seeded: res.ran };
}
