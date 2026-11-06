// D5: the in-process sync service end to end on PGlite, with GitHub replaced
// by a fake (tests/sync/fake-github.ts): the first import and its progress,
// resuming after a quit, a remote change within one cycle, offline and 401
// keeping the cached data, the daily reconcile, wake and "Sync now".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { fakeGitHub, gate, type FakeGitHub } from "./fake-github";

// Belt and braces: anything that slipped past the fakes hits a closed local port, never GitHub.
process.env.DESKA_GITHUB_API_URL = "http://127.0.0.1:10";

const gh = vi.hoisted(() => ({ current: null as FakeGitHub | null }));
vi.mock("@/lib/sync/source-github", async (orig) => {
  const real = await orig<typeof import("@/lib/sync/source-github")>();
  class FakeSource {
    constructor() {
      return gh.current!.cycleSource();
    }
  }
  return { ...real, GitHubSource: FakeSource };
});
vi.mock("@/lib/sync/live", async (orig) => {
  const real = await orig<typeof import("@/lib/sync/live")>();
  class FakeImportSource {
    constructor() {
      return gh.current!.importSource();
    }
  }
  return { ...real, GitHubImportSource: FakeImportSource, githubReconcileSource: () => gh.current!.reconcileSource() };
});

const { getDb } = await import("@/db");
const { setLocalToken } = await import("@/lib/github/local-token");
const { cachedConnection, resetConnectionCache } = await import("@/lib/connection");
const { MESSAGES } = await import("@/lib/github/token-states");
const { readSyncState } = await import("@/lib/sync/runtime");
const { resetSyncService, syncService } = await import("@/lib/sync/service");

const TOKEN = ["github", "pat", "TEST", "FAKE", "SYNC", "0".repeat(20)].join("_");

const rows = async () => (await getDb().execute(sql`SELECT number, title, parent_issue_id IS NOT NULL AS has_parent FROM issues ORDER BY number`)).rows as { number: number; title: string; has_parent: boolean }[];
const kv = async (key: string) => ((await getDb().execute(sql`SELECT value FROM sync_state WHERE key = ${key}`)).rows[0] as { value?: string } | undefined)?.value ?? null;

beforeEach(async () => {
  await resetSyncService();
  resetConnectionCache();
  await getDb().execute(sql`TRUNCATE issues, project_items, project_scan_seen, project_fields, sync_state RESTART IDENTITY CASCADE`);
  gh.current = fakeGitHub({ extra: 5, pageSize: 2 });
  setLocalToken(TOKEN, "launch");
});
afterEach(async () => {
  await resetSyncService();
  setLocalToken(null, "launch");
});

/** After the first import. */
async function imported(): Promise<void> {
  expect((await syncService().request("project")).kind).toBe("imported");
}

describe("the first import", () => {
  it("imports everything with progress, links a parent from a later page, and seeds the cursors", async () => {
    const hold = gate();
    gh.current!.gate = hold.promise;
    const run = syncService().request("project");
    await vi.waitFor(() => expect(syncService().state.running).toBe(true));
    // Held before the first issue page: metadata is in, progress says where it is.
    await vi.waitFor(async () => expect((await readSyncState()).importProgress).toMatchObject({ phase: "open", issues: 0 }));
    expect((await readSyncState()).needsInitialImport).toBe(true);
    gh.current!.gate = null;
    hold.open();
    const out = await run;
    expect(out).toMatchObject({ kind: "imported", result: { resumed: false, issues: 8 } });

    const all = await rows();
    expect(all.map((r) => r.number)).toEqual([100, 101, 102, 200, 201, 202, 203, 204]);
    // #101's parent (#100) was written on a later page and still got linked.
    expect(all.find((r) => r.number === 101)!.has_parent).toBe(true);
    expect(Number((await getDb().execute(sql`SELECT count(*)::int AS n FROM project_items`)).rows[0]!.n)).toBe(3);
    const state = await readSyncState();
    expect(state).toMatchObject({ needsInitialImport: false, importProgress: { phase: null }, lastError: null });
    expect(await kv("reconcile.lastRun")).toBeTruthy();
    // Pages walked oldest first, each starting at the previous page's newest update.
    const pages = gh.current!.calls.issuePages.filter((p) => p.state === "open");
    expect(pages[0]).toEqual({ state: "open", since: null, page: 1 });
    expect(pages.slice(1).every((p) => p.since !== null)).toBe(true);
  });

  it("quitting mid-import and relaunching resumes from the checkpoint, not from scratch", async () => {
    const hold = gate();
    let pagesSeen = 0;
    const source = gh.current!;
    const realPage = source.importSource;
    source.importSource = () => {
      const s = realPage();
      const page = s.issuesPage.bind(s);
      return {
        ...s,
        issuesPage: async (...args) => {
          pagesSeen++;
          // Hold the second open-issue page: the app quits while it is in flight.
          if (pagesSeen === 2) await hold.promise;
          return page(...args);
        },
      };
    };
    const run = syncService().request("project");
    await vi.waitFor(() => expect(pagesSeen).toBe(2));
    const stopping = syncService().stop();
    hold.open();
    expect(await run).toEqual({ kind: "idle", reason: "stopping" });
    await stopping;
    // Not done (no cursor), and the checkpoint is past the first two pages.
    const half = await readSyncState();
    expect(half.needsInitialImport).toBe(true);
    expect(half.importProgress).toMatchObject({ phase: "open", issues: 3 });
    expect(await kv("import.since")).toBeTruthy();

    // Relaunch: a new service in a "new process".
    await resetSyncService();
    source.importSource = realPage;
    source.calls.issuePages = [];
    const out = await syncService().request("launch");
    expect(out).toMatchObject({ kind: "imported", result: { resumed: true } });
    // Metadata wasn't read again, and the first page asked for starts at the checkpoint.
    expect(source.calls.metadata).toBe(1);
    expect(source.calls.issuePages[0]!.since).not.toBeNull();
    expect((await rows()).map((r) => r.number)).toEqual([100, 101, 102, 200, 201, 202, 203, 204]);
    expect((await readSyncState()).needsInitialImport).toBe(false);
  });

  it("a bulk edit (more rows than a page sharing one updated_at) is paged through, not looped or skipped", async () => {
    for (const i of gh.current!.issues) if (i.number >= 200) i.updatedAt = "2026-10-10T10:10:10Z";
    expect(await syncService().request("project")).toMatchObject({ kind: "imported", result: { issues: 8 } });
    expect((await rows()).length).toBe(8);
    expect(gh.current!.calls.issuePages.some((p) => p.page > 1)).toBe(true);
  });

  it("a failure keeps the checkpoint; the next run continues", async () => {
    let n = 0;
    const source = gh.current!;
    const realPage = source.importSource;
    source.importSource = () => {
      const s = realPage();
      const page = s.issuesPage.bind(s);
      return { ...s, issuesPage: async (...args) => (++n === 3 ? Promise.reject(Object.assign(new Error("fetch failed"), { status: 500 })) : page(...args)) };
    };
    expect(await syncService().request("project")).toMatchObject({ kind: "failed", failure: "offline" });
    expect((await readSyncState()).importProgress.issues).toBe(3);
    expect(await syncService().request("interval")).toMatchObject({ kind: "imported", result: { resumed: true } });
    expect((await rows()).length).toBe(8);
  });
});

describe("cycles after the import", () => {
  it("a remote change shows within one cycle", async () => {
    await imported();
    gh.current!.edit(102, { title: "Bug: crash on start (fixed title)" });
    const out = await syncService().request("interval");
    expect(out).toMatchObject({ kind: "ran", result: { issues: { applied: true } } });
    expect((await rows()).find((r) => r.number === 102)!.title).toBe("Bug: crash on start (fixed title)");
  });

  it("wake and Sync now each run a cycle; Sync now right after another run is throttled", async () => {
    await imported();
    const before = gh.current!.calls.changeChecks.length;
    expect((await syncService().request("wake")).kind).toBe("ran");
    expect(gh.current!.calls.changeChecks.length).toBe(before + 1);
    expect(await syncService().request("manual")).toMatchObject({ kind: "skipped", skipped: "too-soon" });
    await getDb().execute(sql`UPDATE sync_state SET value = '' WHERE key = 'sync.lastAttemptAt'`);
    expect((await syncService().request("manual")).kind).toBe("ran");
    expect(gh.current!.calls.changeChecks.length).toBe(before + 2);
  });

  it("offline keeps the cached data and marks it stale; reaching GitHub again clears it", async () => {
    await imported();
    const before = await rows();
    gh.current!.fail = "offline";
    expect(await syncService().request("interval")).toMatchObject({ kind: "failed", failure: "offline" });
    expect(await rows()).toEqual(before);
    expect(cachedConnection()).toMatchObject({ state: "offline", message: MESSAGES.offline });
    expect((await readSyncState()).lastError).toContain("fetch failed");
    gh.current!.fail = null;
    expect((await syncService().request("interval")).kind).toBe("ran");
    expect((await readSyncState()).lastError).toBeNull();
  });

  it("a 401 mid-session shows the token message over the cached data, never an empty cache; the loop waits for a new token", async () => {
    await imported();
    const before = await rows();
    gh.current!.fail = "unauthorized";
    expect(await syncService().request("interval")).toMatchObject({ kind: "failed", failure: "invalid" });
    expect(await rows()).toEqual(before);
    expect(cachedConnection()).toMatchObject({ state: "invalid", message: MESSAGES.invalid });
    // The loop doesn't keep hammering GitHub with a refused token…
    const checks = gh.current!.calls.changeChecks.length;
    expect(await syncService().request("interval")).toEqual({ kind: "idle", reason: "token-refused" });
    expect(gh.current!.calls.changeChecks.length).toBe(checks);
    // …until the token is replaced.
    gh.current!.fail = null;
    setLocalToken(TOKEN, "user");
    expect((await syncService().request("token")).kind).toBe("ran");
  });

  it("reconciles when the last reconcile is older than 24 h, not otherwise", async () => {
    await imported();
    expect((await syncService().request("launch")).kind).toBe("ran");
    expect(gh.current!.calls.reconcile).toBe(0);
    await getDb().execute(sql`UPDATE sync_state SET value = ${new Date(Date.now() - 25 * 3600_000).toISOString()} WHERE key = 'reconcile.lastRun'`);
    const out = await syncService().request("launch");
    expect(out).toMatchObject({ kind: "ran", nightly: { ran: true } });
    expect(gh.current!.calls.reconcile).toBe(1);
  });
});

describe("when not to sync", () => {
  it("without a token, or on a database seeded with sample data, nothing reaches GitHub", async () => {
    setLocalToken(null, "user");
    expect(await syncService().request("launch")).toEqual({ kind: "idle", reason: "no-token" });
    setLocalToken(TOKEN, "user");
    process.env.DESKA_DEMO_SEED = "fixtures";
    try {
      expect(await syncService().request("launch")).toEqual({ kind: "idle", reason: "sample-data" });
    } finally {
      delete process.env.DESKA_DEMO_SEED;
    }
    expect(gh.current!.calls.metadata + gh.current!.calls.changeChecks.length).toBe(0);
  });
});
