// F7 against Postgres with pg_trgm. Skipped unless TEST_DATABASE_URL points at a
// throwaway, migrated database (the migration creates the extension).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { demoSnapshot } from "@/lib/demo/generate";
import { duplicatesOf } from "@/lib/server/duplicates";
import { importFull } from "@/lib/sync/import";
import { PostgresStore } from "@/lib/sync/store-postgres";
import type { SnapshotIssue } from "@/lib/sync/types";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const extra = (n: number, title: string, over: Partial<SnapshotIssue> = {}): SnapshotIssue => ({
  nodeId: `I_dup${n}`,
  number: 900_000 + n,
  title,
  body: "",
  state: "open",
  stateReason: null,
  typeId: null,
  parentNodeId: null,
  milestoneId: null,
  authorLogin: "alice",
  url: `https://github.com/acme/widgets/issues/${900_000 + n}`,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  closedAt: null,
  labelIds: [],
  assigneeIds: [],
  ...over,
});

suite("possible duplicates (Postgres, pg_trgm)", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, pull_requests, pr_labels, pr_assignees, pr_review_requests, pr_reviews, pr_issue_links, gh_team_members RESTART IDENTITY CASCADE`,
    );
    const snapshot = demoSnapshot();
    const closedRecently = new Date(Date.now() - 5 * 86_400_000).toISOString();
    await importFull(
      {
        ...snapshot,
        issues: [
          ...snapshot.issues,
          extra(1, "Bluetooth pairing drops after firmware update on Android"),
          extra(2, "Bluetooth pairing drops after the firmware update on Android"),
          extra(3, "Bluetooth pairing dropped after firmware update on Android", { state: "closed", closedAt: closedRecently }),
          extra(4, "Bluetooth pairing drops after firmware update on Android", { state: "closed", closedAt: "2024-01-01T00:00:00Z" }),
          extra(5, "Completely unrelated pineapple pizza request"),
        ],
      },
      new PostgresStore(),
    );
  }, 120_000);
  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  it("near-identical titles find each other, closed ones only when recent, unrelated ones never", async () => {
    const first = await duplicatesOf(900_001);
    expect(first?.map((d) => d.number)).toEqual([900_002, 900_003]);
    expect(first![0]!.similarity).toBeGreaterThan(0.8);
    expect(first!.find((d) => d.number === 900_003)?.state).toBe("closed");
    expect((await duplicatesOf(900_002))?.map((d) => d.number)).toContain(900_001);
    expect(await duplicatesOf(900_005)).toEqual([]);
    expect(await duplicatesOf(123_456_789)).toBeNull();
  });

  it("answers in under 100 ms on the generated demo dataset", async () => {
    await duplicatesOf(900_001); // plan and connection warm-up
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await duplicatesOf(900_001);
      runs.push(performance.now() - t0);
    }
    expect(Math.min(...runs)).toBeLessThan(100);
  });
});
