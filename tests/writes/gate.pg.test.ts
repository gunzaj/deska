// W0: the write gate of SPEC §3.4. A GitHub write happens only when all three
// parts hold; with any part off, `writeContext()` refuses before the outbox is
// touched, so nothing is ever sent. Runs on an in-memory PGlite database.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("@/lib/session", () => ({ getViewerLogin: async () => "alice" }));

const TOKEN = ["github", "pat", "GATE", "FAKE", "0".repeat(24)].join("_");

describe("the write gate (W0, SPEC §3.4)", async () => {
  const { getDb } = await import("@/db");
  const { setLocalToken } = await import("@/lib/github/local-token");
  const { resetSettingsCache, saveWriteAccess, saveWrites } = await import("@/lib/settings");
  const { accountChanged, consumeTokenChangeReset, setWritesOn, writeGate } = await import("@/lib/writes/gate");
  const { drainOutbox, enqueueEdit, getEdit, SIGN_IN_CHANGED } = await import("@/lib/outbox/store");
  const { noteTokenChange } = await import("@/lib/writes/token-change");
  const { writeContext } = await import("@/lib/outbox/http");
  const { importFull } = await import("@/lib/sync/import");
  const { PostgresStore } = await import("@/lib/sync/store-postgres");
  const { fixtureSnapshot } = await import("../fixtures/github");

  const WRITES_KEY = "github.writes";
  const ACCESS_KEY = "github.write-access";

  beforeEach(async () => {
    delete process.env.DESKA_WRITES;
    resetSettingsCache();
    setLocalToken(null, "launch");
    await getDb().execute(sql`DELETE FROM app_settings WHERE key IN (${WRITES_KEY}, ${ACCESS_KEY})`);
    await getDb().execute(sql`TRUNCATE issues, project_items, project_scan_seen, field_options, iterations, project_fields, labels, milestones, gh_users, issue_types, sync_state RESTART IDENTITY CASCADE`);
    await importFull(fixtureSnapshot(), new PostgresStore());
  });

  it("a token change fails the edits still waiting: they are not sent later under the new sign-in", async () => {
    process.env.DESKA_WRITES = "on";
    await getDb().execute(sql`TRUNCATE outbox, audit_log`);
    // An edit on backoff (GitHub was flaky), and a create.
    const waiting = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "update", field: "labels", base: null, next: { added: ["bug"], removed: [] }, idempotencyKey: "alice:waiting" });
    const create = await enqueueEdit({ userId: "alice", issueNodeId: "", op: "create", field: null, base: null, next: { title: "New" }, idempotencyKey: "alice:create" });
    await getDb().execute(sql`UPDATE outbox SET next_attempt_at = now() + interval '30 seconds', attempts = 1 WHERE id = ${waiting.id}`);
    noteTokenChange();
    await writeGate();
    for (const id of [waiting.id, create.id]) expect(await getEdit(id)).toMatchObject({ status: "failed", error: SIGN_IN_CHANGED });
    expect(Number((await getDb().execute(sql`SELECT count(*)::int AS n FROM audit_log WHERE result = 'failed'`)).rows[0]!.n)).toBe(2);
    // Writes come back on, with the new token: nothing is left to send.
    await saveWriteAccess({ state: "yes", message: null, checkedAt: new Date().toISOString() });
    await setWritesOn(true);
    const applyField = vi.fn();
    const { processed } = await drainOutbox(async () => ({ client: { applyField, readField: vi.fn(), closeIssue: vi.fn(), reopenIssue: vi.fn() }, doneStatusOptionId: "" }));
    expect(processed).toEqual([]);
    expect(applyField).not.toHaveBeenCalled();
    delete process.env.DESKA_WRITES;
  });

  it("another account behind the same sign-in source: writes go off and waiting edits fail", async () => {
    await getDb().execute(sql`TRUNCATE outbox, audit_log`);
    await saveWrites(true);
    await saveWriteAccess({ state: "yes", message: null, checkedAt: new Date().toISOString() });
    const waiting = await enqueueEdit({ userId: "alice", issueNodeId: "I_bug", op: "update", field: "priority", base: null, next: "b0000003", idempotencyKey: "alice:account" });
    await accountChanged();
    const gate = await writeGate();
    // The new token's permissions stay as the check recorded them; the switch is what goes off.
    expect(gate).toMatchObject({ settingOn: false, tokenAccess: "yes" });
    expect((await getEdit(waiting.id))?.status).toBe("failed");
  });

  it("build off: nothing is written, whatever the setting and token say", async () => {
    await saveWrites(true);
    await saveWriteAccess({ state: "yes", message: null, checkedAt: new Date().toISOString() });
    setLocalToken(TOKEN, "launch");
    const gate = await writeGate();
    expect(gate).toMatchObject({ allowed: false, buildAllows: false, settingOn: true, tokenAccess: "yes" });
    expect(gate.reason).toBe("Editing is off for this deployment");
  });

  it("setting off: nothing is written, whatever the token can do", async () => {
    process.env.DESKA_WRITES = "on";
    await saveWrites(false);
    await saveWriteAccess({ state: "yes", message: null, checkedAt: new Date().toISOString() });
    setLocalToken(TOKEN, "launch");
    const gate = await writeGate();
    expect(gate).toMatchObject({ allowed: false, buildAllows: true, settingOn: false, tokenAccess: "yes" });
    expect(gate.reason).toContain("off in Settings");
    delete process.env.DESKA_WRITES;
  });

  it("token write permissions unknown: nothing is written", async () => {
    process.env.DESKA_WRITES = "on";
    await saveWrites(true);
    await saveWriteAccess({ state: "unknown", message: null, checkedAt: null });
    setLocalToken(TOKEN, "launch");
    const gate = await writeGate();
    expect(gate).toMatchObject({ allowed: false, tokenAccess: "unknown" });
    expect(gate.reason).toContain("not checked yet");
    delete process.env.DESKA_WRITES;
  });

  it("read-only token: nothing is written, and the reason names why", async () => {
    process.env.DESKA_WRITES = "on";
    await saveWrites(true);
    await saveWriteAccess({ state: "no", message: "This token can't write: missing Organization → Projects: Read and write", checkedAt: null });
    setLocalToken(TOKEN, "launch");
    const gate = await writeGate();
    expect(gate).toMatchObject({ allowed: false, tokenAccess: "no" });
    expect(gate.reason).toContain("Organization → Projects: Read and write");
    delete process.env.DESKA_WRITES;
  });

  it("all three parts: writes are allowed", async () => {
    process.env.DESKA_WRITES = "on";
    await saveWrites(true);
    await saveWriteAccess({ state: "yes", message: null, checkedAt: new Date().toISOString() });
    setLocalToken(TOKEN, "launch");
    const gate = await writeGate();
    expect(gate).toMatchObject({ allowed: true, reason: null });
    delete process.env.DESKA_WRITES;
  });

  it("a user token change turns writes off and forgets the detection", async () => {
    process.env.DESKA_WRITES = "on";
    await saveWrites(true);
    await saveWriteAccess({ state: "yes", message: null, checkedAt: new Date().toISOString() });
    setLocalToken(TOKEN, "user");
    const gate = await writeGate();
    expect(gate).toMatchObject({ allowed: false, settingOn: false, tokenAccess: "unknown" });
    delete process.env.DESKA_WRITES;
  });

  it("the switch can't turn on without a detected write permission", async () => {
    process.env.DESKA_WRITES = "on";
    await saveWriteAccess({ state: "no", message: "Read-only token", checkedAt: null });
    const gate = await setWritesOn(true);
    expect(gate.allowed).toBe(false);
    expect(gate.settingOn).toBe(false);
    delete process.env.DESKA_WRITES;
  });

  it("every refusal is a 403 before the outbox: one per gate part", async () => {
    // Nothing enqueued, no write client built: writeContext() answers first.
    const refuse = async () => {
      const ctx = await writeContext();
      expect(ctx instanceof (await import("next/server")).NextResponse).toBe(true);
      const res = ctx as Response;
      expect(res.status).toBe(403);
      return (await res.json()) as { error: string; writesOff: boolean };
    };
    // Part 2: the setting.
    process.env.DESKA_WRITES = "on";
    await saveWrites(false);
    await saveWriteAccess({ state: "yes", message: null, checkedAt: null });
    setLocalToken(TOKEN, "launch");
    expect((await refuse()).error).toContain("off in Settings");
    await saveWrites(true);
    await saveWriteAccess({ state: "unknown", message: null, checkedAt: null });
    expect((await refuse()).error).toContain("not checked yet");
    // Part 1: the token's permissions.
    await saveWriteAccess({ state: "no", message: "Read-only token", checkedAt: null });
    expect((await refuse()).error).toBe("Read-only token");
    // Part 3: the build.
    await saveWriteAccess({ state: "yes", message: null, checkedAt: null });
    delete process.env.DESKA_WRITES;
    expect((await refuse()).error).toBe("Editing is off for this deployment");
  });

  it("with all three parts, the write context is the viewer, token and cache", async () => {
    process.env.DESKA_WRITES = "on";
    await saveWrites(true);
    await saveWriteAccess({ state: "yes", message: null, checkedAt: new Date().toISOString() });
    setLocalToken(TOKEN, "launch");
    const ctx = await writeContext();
    expect(ctx).not.toBeInstanceOf((await import("next/server")).NextResponse);
    expect(ctx).toMatchObject({ viewer: "alice", token: TOKEN });
    delete process.env.DESKA_WRITES;
  });

  it("the token-change flag is consumed once", async () => {
    noteTokenChange();
    expect(await consumeTokenChangeReset()).toBe(true);
    expect(await consumeTokenChangeReset()).toBe(false);
  });
});
