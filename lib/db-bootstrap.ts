// Opens the local database when the server starts (instrumentation-node.ts):
// applies pending migrations and, for tests, dev and the preview only, seeds
// a fictional sample dataset into an empty database when DESKA_DEMO_SEED asks
// for it. The desktop app itself never sets it (D5): its cache is filled by the
// first import from GitHub, and a database seeded with sample data is never
// synced (lib/sync/service.ts), so the two never mix.
import { sql } from "drizzle-orm";
import { dbDir, ensureMigrated, getDb } from "@/db";
import { backupBeforeMigration } from "./backup/files";
import { demoSnapshot } from "./demo/generate";
import { fixtureSnapshot } from "./demo/fixtures";
import { altFixtureSnapshot } from "./demo/fixtures-alt";
import { initialImport } from "./sync/initial";
import { withLockedSyncKv } from "./sync/runtime";
import { PostgresStore } from "./sync/store-postgres";

export type DemoSeed = "demo" | "fixtures" | "alt" | "alt-no-sprint";

/**
 * `DESKA_DEMO_SEED`: `demo` (the rich dataset), `fixtures` (the small test
 * set), or `alt` / `alt-no-sprint` (the test set on a project with
 * differently named fields, with or without an iteration field; D4).
 */
export function demoSeed(env: Record<string, string | undefined> = process.env): DemoSeed | null {
  const v = env.DESKA_DEMO_SEED?.trim();
  return v === "demo" || v === "fixtures" || v === "alt" || v === "alt-no-sprint" ? v : null;
}

/** The snapshot a demo seed imports. */
export function seedSnapshot(seed: DemoSeed) {
  if (seed === "alt" || seed === "alt-no-sprint") return altFixtureSnapshot({ sprint: seed === "alt" });
  return seed === "fixtures" ? fixtureSnapshot() : demoSnapshot();
}

/** Migrate, then seed demo data into an empty cache if asked to. */
export async function prepareDatabase(): Promise<{ seeded: boolean }> {
  if (!dbDir()) return { seeded: false };
  // Forces the database open: a damaged one fails here, before anything else.
  await getDb().execute(sql`SELECT 1`);
  // Pending migrations on a database with data: a backup first (SPEC §4.7).
  await backupBeforeMigration();
  await ensureMigrated();
  const seed = demoSeed();
  if (!seed) return { seeded: false };
  const { rows } = await getDb().execute(sql`SELECT count(*)::int AS n FROM issues`);
  if (Number((rows[0] as { n: number } | undefined)?.n ?? 0) > 0) return { seeded: false };
  const snapshot = seedSnapshot(seed);
  const res = await withLockedSyncKv((kv) => initialImport(snapshot, new PostgresStore(), kv), { waitMs: 60_000, retryMs: 500 });
  return { seeded: res.ran };
}
