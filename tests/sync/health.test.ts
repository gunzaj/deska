// S3: sync health — error/counter bookkeeping, redaction, /api/health.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { syncWarning } from "@/lib/client/sync-health";
import { healthOf, MAX_ERROR_LENGTH, recordCycle, redactError } from "@/lib/sync/health";
import { MapKv } from "@/lib/sync/poll";
import { getSyncKv } from "@/lib/sync/runtime";
import { MemoryStore } from "@/lib/sync/store-memory";
import { triggerSync } from "@/lib/sync/trigger";

// Assembled at runtime so the leak guard never sees a token-shaped literal.
const FAKE_TOKEN = ["ghp", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_");
const FAKE_PAT = ["github", "pat", "11AAAAAAA0123456789", "abcdefghij"].join("_");

function source(fail: () => boolean) {
  return {
    checkChanges: vi.fn(async () => {
      if (fail()) throw new Error(`GitHub 502 for request with token ${FAKE_TOKEN}`);
      return { kind: "not-modified" as const };
    }),
    scanProjectItems: vi.fn(async () => ({ items: [], nextCursor: null, total: 0 })),
    scanOpenPullRequests: vi.fn(async () => []),
    teamMembers: vi.fn(async () => []),
  };
}

describe("cycle health bookkeeping", () => {
  beforeEach(async () => {
    const kv = await getSyncKv();
    kv.set("issues.since", "2026-10-01T00:00:00Z");
    kv.set("sync.lastError", "");
    kv.set("sync.consecutiveFailures", "0");
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("a throwing source sets lastError and counts; the next success clears both", async () => {
    let failing = true;
    const src = source(() => failing);
    const store = new MemoryStore();
    const kv = await getSyncKv();

    await expect(triggerSync(src, store, { manual: false })).rejects.toThrow("GitHub 502");
    expect(kv.get("sync.lastError")).toContain("GitHub 502");
    expect(kv.get("sync.consecutiveFailures")).toBe("1");
    expect(kv.get("sync.lastAttemptAt")).not.toBeNull();

    await expect(triggerSync(src, store, { manual: false })).rejects.toThrow();
    expect(kv.get("sync.consecutiveFailures")).toBe("2");

    failing = false;
    await triggerSync(src, store, { manual: false });
    expect(kv.get("sync.lastError")).toBe("");
    expect(kv.get("sync.consecutiveFailures")).toBe("0");
  });

  it("lastError never contains the token", async () => {
    const src = source(() => true);
    await expect(triggerSync(src, new MemoryStore(), { manual: false })).rejects.toThrow();
    const stored = (await getSyncKv()).get("sync.lastError") ?? "";
    expect(stored).not.toContain(FAKE_TOKEN);
    expect(stored).toContain("[redacted]");
  });

  it("logs one JSON line per cycle", async () => {
    const lines: string[] = [];
    const kv = new MapKv();
    await recordCycle(kv, async () => ({ issues: { applied: false }, project: null, prs: null }), { log: (l) => lines.push(l) });
    await recordCycle(kv, async () => Promise.reject(new Error("boom")), { log: (l) => lines.push(l) }).catch(() => {});
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { kind: "sync", ok: true, durationMs: expect.any(Number), issues: { applied: false }, project: null, prs: null, error: null },
      { kind: "sync", ok: false, durationMs: expect.any(Number), error: "boom" },
    ]);
  });

  it("a returned partial failure counts as a failed cycle", async () => {
    const kv = new MapKv();
    await recordCycle(kv, async () => ({ errors: ["PR scan: 502"] }), { failure: (r) => r.errors.join("; "), log: () => {} });
    expect(kv.get("sync.lastError")).toBe("PR scan: 502");
    expect(kv.get("sync.consecutiveFailures")).toBe("1");
  });
});

describe("redactError", () => {
  it("removes configured secrets, token shapes, bearer values and URL credentials", () => {
    const env = { GITHUB_TOKEN: "s3cr3t-token-value-xyz" };
    const out = redactError(
      new Error(
        `failed with s3cr3t-token-value-xyz; Authorization: Bearer abcdefghijklmnop1234; ${FAKE_TOKEN}; ${FAKE_PAT}; connect postgres://deska:hunter2@host/db; ?access_token=zzz`,
      ),
      env,
    );
    for (const secret of ["s3cr3t-token-value-xyz", "abcdefghijklmnop1234", FAKE_TOKEN, FAKE_PAT, "hunter2", "zzz"]) {
      expect(out).not.toContain(secret);
    }
  });

  it("keeps ordinary messages and caps the length", () => {
    expect(redactError(new Error("token expired"), {})).toBe("token expired");
    expect(redactError("x".repeat(2000), {})).toHaveLength(MAX_ERROR_LENGTH);
  });
});

describe("/api/health", () => {
  afterEach(async () => {
    (await getSyncKv()).set("sync.lastSync", "");
  });

  it("is 503 when the last sync is 2 h old", async () => {
    (await getSyncKv()).set("sync.lastSync", new Date(Date.now() - 2 * 3600_000).toISOString());
    const res = await health();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, lastSyncAgeSec: expect.any(Number) });
  });

  it("is 200 with a recent sync and 503 with none", async () => {
    (await getSyncKv()).set("sync.lastSync", new Date(Date.now() - 60_000).toISOString());
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, lastSyncAgeSec: 60 });
    (await getSyncKv()).set("sync.lastSync", "");
    expect((await health()).status).toBe(503);
  });

  it("healthOf honours the max age", () => {
    const kv = new MapKv();
    kv.set("sync.lastSync", "2026-10-13T10:00:00Z");
    const now = Date.parse("2026-10-13T10:30:00Z");
    expect(healthOf(kv, now, 1800)).toEqual({ ok: true, lastSyncAgeSec: 1800 });
    expect(healthOf(kv, now + 1000, 1800)).toEqual({ ok: false, lastSyncAgeSec: 1801 });
  });
});

describe("sync chip warning", () => {
  const base = { lastSync: "2026-10-13T10:00:00Z", lastAttemptAt: null, lastError: null, consecutiveFailures: 0 };
  const now = Date.parse("2026-10-13T10:05:00Z");
  it("warns after 3 failures in a row or 15 min without a sync", () => {
    expect(syncWarning(base, now)).toBeNull();
    expect(syncWarning({ ...base, consecutiveFailures: 2 }, now)).toBeNull();
    expect(syncWarning({ ...base, consecutiveFailures: 3 }, now)).toBe("failing");
    expect(syncWarning(base, now + 15 * 60_000)).toBe("stale");
  });
});
