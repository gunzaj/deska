// S5 against Postgres: the sync generation, the ETag following it, and a read
// model without bodies. Skipped unless TEST_DATABASE_URL is set.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("sync generation and ETags (Postgres)", async () => {
  const { getDb } = await import("@/db");
  const { importFull } = await import("@/lib/sync/import");
  const { readGeneration } = await import("@/lib/sync/generation");
  const { PostgresStore, readSnapshot } = await import("@/lib/sync/store-postgres");
  const { cachedDetail } = await import("@/lib/server/issue-detail");
  const { getStore } = await import("@/lib/store");
  const { GET } = await import("@/app/api/data/route");
  const { fixtureSnapshot } = await import("../fixtures/github");

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await getDb().execute(
      sql`TRUNCATE issues, issue_labels, issue_assignees, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state, pull_requests, pr_labels, pr_assignees, pr_review_requests, pr_reviews, pr_issue_links, gh_team_members RESTART IDENTITY CASCADE`,
    );
    await importFull(fixtureSnapshot(), new PostgresStore());
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => {
    delete process.env.DATABASE_URL;
  });

  it("bumps the generation on a change, not on an unchanged import", async () => {
    const before = Number(await readGeneration());
    expect(before).toBeGreaterThan(0);
    await importFull(fixtureSnapshot(), new PostgresStore());
    expect(Number(await readGeneration())).toBe(before);
    const snap = fixtureSnapshot();
    snap.issues[0] = { ...snap.issues[0]!, title: "Renamed on GitHub" };
    await importFull(snap, new PostgresStore());
    expect(Number(await readGeneration())).toBe(before + 1);
  });

  it("an ETag gets 304 until a sync bumps the generation, then 200", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const first = await GET(new NextRequest("http://x/api/data"));
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag")!;
    expect((await GET(new NextRequest("http://x/api/data", { headers: { "if-none-match": etag } }))).status).toBe(304);

    const snap = fixtureSnapshot();
    snap.issues[0] = { ...snap.issues[0]!, title: "Renamed again" };
    await importFull(snap, new PostgresStore());
    // Each instance checks the generation at most every 5 s.
    vi.setSystemTime(Date.now() + 6_000);
    const after = await GET(new NextRequest("http://x/api/data", { headers: { "if-none-match": etag } }));
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(etag);
    expect((await after.json()).issues.some((i: { t: string }) => i.t === "Renamed again")).toBe(true);
  });

  it("readSnapshot carries no body; the panel reads the one body it needs", async () => {
    const snap = await readSnapshot();
    expect(snap.issues.length).toBeGreaterThan(0);
    for (const i of snap.issues) expect(Object.keys(i)).not.toContain("body");
    for (const p of snap.pullRequests ?? []) expect(Object.keys(p)).not.toContain("body");

    const withBody = fixtureSnapshot().issues.find((i) => i.body)!;
    const detail = await cachedDetail(await getStore(), withBody.number, "offline");
    expect(detail?.body).toBe(withBody.body);
  });
});
