// F6 against Postgres: the watchlist and what changed since the last look.
// Skipped unless TEST_DATABASE_URL points at a throwaway, migrated database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { importFull } from "@/lib/sync/import";
import { PostgresStore } from "@/lib/sync/store-postgres";
import { collectWatchChanges } from "@/lib/watch/changes";
import { addWatch, listWatches, markSeen, removeWatch } from "@/lib/watch/repo";
import { saveView } from "@/lib/views/runtime";
import { fixtureSnapshot } from "../fixtures/github";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

async function truncate() {
  await getDb().execute(
    sql`TRUNCATE watches, views, issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, pull_requests, pr_labels, pr_assignees, pr_review_requests, pr_reviews, pr_issue_links, gh_team_members RESTART IDENTITY CASCADE`,
  );
}
const tick = () => new Promise((r) => setTimeout(r, 15));

suite("watchlist (Postgres)", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = url;
  });
  beforeEach(truncate);
  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  it("watches are per person; watching again keeps the old last-seen time; stop removes", async () => {
    const first = await addWatch("Alice", "issue", "I_1", new Date("2026-10-01T00:00:00Z"));
    const again = await addWatch("alice", "issue", "I_1", new Date("2026-10-09T00:00:00Z"));
    expect(again.lastSeenAt).toBe(first.lastSeenAt);
    await addWatch("bob", "view", "v1");
    expect((await listWatches("alice")).map((w) => `${w.kind}:${w.targetId}`)).toEqual(["issue:I_1"]);
    expect(await markSeen("bob", "issue", "I_1")).toBeNull();
    await removeWatch("alice", "issue", "I_1");
    expect(await listWatches("alice")).toEqual([]);
    expect(await listWatches("bob")).toHaveLength(1);
  });

  it("changing a watched issue's Status via sync shows one change; opening it clears the change", async () => {
    const store = new PostgresStore();
    const snapshot = fixtureSnapshot();
    await importFull(snapshot, store);
    const target = snapshot.projectItems[0]!;
    const watched = target.issueNodeId;
    const other = snapshot.projectItems.find((p) => p.issueNodeId !== watched)!.issueNodeId;
    await saveView("alice", { id: "v1", name: "All issues", ownerId: "alice", visibility: "personal", layout: "list", filters: [], sort: [] });
    await addWatch("alice", "issue", watched);
    await addWatch("alice", "view", "v1");
    await addWatch("bob", "issue", other);
    await tick();
    const newStatus = (snapshot.fields.find((f) => f.name === "Status")?.options ?? []).find((o) => o.id !== target.statusOpt)!.id;
    await importFull({ ...snapshot, projectItems: snapshot.projectItems.map((p) => (p === target ? { ...p, statusOpt: newStatus } : p)) }, store);

    const query = [
      { kind: "issue", targetId: watched },
      { kind: "view", targetId: "v1" },
      // Not watched by this login: ignored.
      { kind: "issue", targetId: other },
    ];
    const got = await collectWatchChanges("alice", query);
    expect(Object.keys(got).sort()).toEqual([`issue:${watched}`, "view:v1"]);
    expect(got[`issue:${watched}`]).toHaveLength(1);
    expect(got[`issue:${watched}`]![0]).toMatchObject({ issueNodeId: watched, field: "status", oldValue: target.statusOpt, newValue: newStatus });
    expect(got["view:v1"]).toHaveLength(1);

    await tick();
    await markSeen("alice", "issue", watched);
    const after = await collectWatchChanges("alice", query);
    expect(after[`issue:${watched}`]).toEqual([]);
    // The view was not opened: its change is still news.
    expect(after["view:v1"]).toHaveLength(1);
  });

  it("assignee changes come back as logins", async () => {
    const store = new PostgresStore();
    const snapshot = fixtureSnapshot();
    await importFull(snapshot, store);
    const issue = snapshot.issues[0]!;
    await addWatch("alice", "issue", issue.nodeId);
    await tick();
    const user = snapshot.ghUsers.find((u) => !issue.assigneeIds.includes(u.githubId))!;
    await importFull({ ...snapshot, projectItems: [], issues: snapshot.issues.map((i) => (i === issue ? { ...i, assigneeIds: [user.githubId] } : i)) }, store);
    const got = await collectWatchChanges("alice", [{ kind: "issue", targetId: issue.nodeId }], (id) => (id === user.githubId ? user.login : id));
    const change = got[`issue:${issue.nodeId}`]!.find((c) => c.field === "assignees")!;
    expect(JSON.parse(change.newValue!)).toContain(user.login);
  });
});
