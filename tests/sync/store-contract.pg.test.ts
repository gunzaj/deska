// Skipped unless TEST_DATABASE_URL points at a throwaway, migrated database.
import { afterAll, beforeAll, describe } from "vitest";
import { sql } from "drizzle-orm";
import { storeContract } from "./store-contract";

const url = process.env.TEST_DATABASE_URL;

if (!url) {
  describe.skip("PostgresStore: sync store contract", () => {});
} else {
  const { getDb } = await import("@/db");
  const { ReadModel } = await import("@/lib/sync/read-model");
  const { PostgresStore, readSnapshot } = await import("@/lib/sync/store-postgres");
  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });
  afterAll(() => {
    delete process.env.DATABASE_URL;
  });
  storeContract("PostgresStore", async () => {
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, outbox, audit_log, issue_field_changes RESTART IDENTITY CASCADE`,
    );
    return { store: new PostgresStore(), read: async () => ReadModel.fromSnapshot(await readSnapshot()) };
  });
}
