// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { sql } from "drizzle-orm";
import { storeContract } from "./store-contract";

import { getDb } from "@/db";
import { ReadModel } from "@/lib/sync/read-model";
import { PostgresStore, readSnapshot } from "@/lib/sync/store-postgres";

storeContract("PostgresStore", async () => {
  await getDb().execute(
    sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, outbox, audit_log, issue_field_changes RESTART IDENTITY CASCADE`,
  );
  return {
    store: new PostgresStore(),
    read: async () => ReadModel.fromSnapshot(await readSnapshot()),
    changes: async () =>
      (await getDb().execute(sql`SELECT i.gh_node_id AS "issueNodeId", c.field FROM issue_field_changes c JOIN issues i ON i.id = c.issue_id`)).rows as {
        issueNodeId: string;
        field: string;
      }[],
  };
});
