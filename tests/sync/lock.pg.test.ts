// S1 on PGlite: the in-process lock serialises cycles writing one database.
// Runs on an in-memory PGlite database (tests/setup/db.ts).
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { issues } from "@/db/schema";
import type { CycleSource } from "@/lib/sync/cycle";
import { withSyncLock } from "@/lib/sync/lock";
import type { ChangeCheck } from "@/lib/sync/poll";
import { PostgresStore } from "@/lib/sync/store-postgres";
import { triggerSync } from "@/lib/sync/trigger";
import type { SnapshotIssue } from "@/lib/sync/types";

const newIssue: SnapshotIssue = {
  nodeId: "I_race",
  number: 4242,
  title: "Inserted by two cycles at once",
  body: "",
  state: "open",
  stateReason: null,
  milestoneId: null,
  authorLogin: "alice",
  url: "https://github.com/acme/widgets/issues/4242",
  createdAt: "2026-10-13T08:00:00Z",
  updatedAt: "2026-10-13T08:00:00Z",
  closedAt: null,
  labelIds: [],
  assigneeIds: [],
};

/** Reports the same new issue to every cycle, slowly enough to overlap. */
function racingSource() {
  return {
    checkChanges: vi.fn(async (): Promise<ChangeCheck> => {
      await new Promise((r) => setTimeout(r, 300));
      return { kind: "changed", issues: [newIssue], items: [], etag: "e1", since: newIssue.updatedAt };
    }),
    scanProjectItems: vi.fn(async () => ({ items: [], nextCursor: null, total: 0 })),
    scanOpenPullRequests: vi.fn(async () => []),
    teamMembers: vi.fn(async () => []),
  } satisfies CycleSource;
}

describe("sync lock (PGlite)", () => {
  beforeAll(async () => {
    await getDb().execute(sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, sync_state RESTART IDENTITY CASCADE`);
    // After the initial import: polls only run from a cursor (S2).
    await getDb().execute(sql`INSERT INTO sync_state (key, value) VALUES ('issues.since', '2026-10-01T00:00:00Z')`);
  });

  it("two parallel cycles: one runs, one skips, no unique-key error", async () => {
    const a = racingSource();
    const b = racingSource();
    const results = await Promise.all([
      triggerSync(a, new PostgresStore(), { manual: false }),
      triggerSync(b, new PostgresStore(), { manual: false }),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["ran", "skipped"]);
    expect(results.find((r) => r.kind === "skipped")).toMatchObject({ skipped: "sync-in-progress" });
    expect(a.checkChanges.mock.calls.length + b.checkChanges.mock.calls.length).toBe(1);
    const rows = await getDb().select().from(issues).where(sql`${issues.ghNodeId} = 'I_race'`);
    expect(rows).toHaveLength(1);
  });

  it("is released when fn throws", async () => {
    await expect(withSyncLock(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await withSyncLock(async () => "free")).toEqual({ ran: true, value: "free" });
  });
});
