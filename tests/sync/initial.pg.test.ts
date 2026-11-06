// S2 against Postgres: sync:full seeds the cursors so the cron can take over.
// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { syncState } from "@/db/schema";
import { syncFull } from "@/lib/sync/initial";
import { PostgresStore } from "@/lib/sync/store-postgres";
import { fixtureSnapshot } from "../fixtures/github";

describe("sync:full --db (Postgres)", () => {
  beforeAll(async () => {
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, pull_requests, pr_labels, pr_assignees, pr_review_requests, pr_reviews, pr_issue_links, gh_team_members RESTART IDENTITY CASCADE`,
    );
  });

  it("leaves issues.since, project.lastScan and prs.lastScan set, and is idempotent", async () => {
    const snapshot = fixtureSnapshot();
    const res = await syncFull(snapshot, new PostgresStore(), { waitMs: 0 });
    expect(res.ran).toBe(true);
    if (!res.ran) return;
    expect(res.value.first.inserted).toBeGreaterThan(0);
    expect(res.value.second).toMatchObject({ inserted: 0, updated: 0 });

    // Read the table, not the process cache: the cron runs in another process.
    const rows = new Map((await getDb().select().from(syncState)).map((r) => [r.key, r.value]));
    const newest = snapshot.issues.map((i) => i.updatedAt).sort().at(-1);
    expect(rows.get("issues.since")).toBe(newest);
    expect(Date.parse(rows.get("project.lastScan") ?? "")).not.toBeNaN();
    expect(Date.parse(rows.get("prs.lastScan") ?? "")).not.toBeNaN();
    expect(Date.parse(rows.get("sync.lastSync") ?? "")).not.toBeNaN();
  });
});
