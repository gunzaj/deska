import { describe, expect, it } from "vitest";
import { needsBulkConfirm, type OutboxEntry } from "@/lib/outbox/queue";
import { isRetryable, processEntry, type AuditRecord, type WriteClient } from "@/lib/outbox/worker";

function fakeClient(remote: Record<string, unknown>, failTimes = 0): WriteClient & { log: string[]; remote: Record<string, unknown> } {
  let failures = 0;
  const log: string[] = [];
  return {
    log,
    remote,
    async readField(node, field) {
      return remote[`${node}:${field}`];
    },
    async applyField(node, field, next) {
      if (failures < failTimes) {
        failures += 1;
        throw Object.assign(new Error("boom"), { status: 500 });
      }
      // label deltas merge: concurrent different-label edits both survive
      if (field === "labels") {
        const cur = new Set(remote[`${node}:${field}`] as string[] ?? []);
        for (const l of (next as { added: string[]; removed: string[] }).added) cur.add(l);
        for (const l of (next as { added: string[]; removed: string[] }).removed) cur.delete(l);
        remote[`${node}:${field}`] = [...cur];
      } else {
        remote[`${node}:${field}`] = next;
      }
      log.push(`apply ${node} ${field}`);
    },
    async closeIssue(node) {
      remote[`${node}:state`] = "closed";
      log.push(`close ${node}`);
    },
    async reopenIssue(node) {
      remote[`${node}:state`] = "open";
      log.push(`reopen ${node}`);
    },
    async createIssue() {
      return { nodeId: "I_new", number: 999 };
    },
    async addProjectItem() {},
  };
}

function entry(over: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: "ob-1", userId: "alice", issueNodeId: "I_1", op: "update",
    field: "status", idempotencyKey: "k-1", base: "a0000001", next: "a0000002",
    status: "pending", attempts: 0, error: null, ...over,
  };
}

describe("write-back (M6)", () => {
  it("confirms bulk edits over 50", () => {
    expect(needsBulkConfirm(50)).toBe(false);
    expect(needsBulkConfirm(51)).toBe(true);
  });

  // Idempotency and the HIGH -> LOW -> HIGH regression are covered by the
  // durable outbox (tests/outbox/store.pg.test.ts): keys are per user action.

  it("successful write updates the cache", async () => {
    const client = fakeClient({ "I_1:status": "a0000001" });
    const audit: AuditRecord[] = [];
    const e = entry();
    await processEntry(e, client, audit, "a0000006");
    expect(e.status).toBe("done");
    expect(client.remote["I_1:status"]).toBe("a0000002");
  });

  it("failure reverts (entry failed, cache untouched)", async () => {
    const client = fakeClient({ "I_1:status": "a0000001" }, 99);
    const failing: WriteClient = {
      ...client,
      applyField: async () => {
        throw Object.assign(new Error("bad request"), { status: 400 });
      },
    };
    const audit: AuditRecord[] = [];
    const e = entry();
    await processEntry(e, failing, audit, "a0000006");
    expect(e.status).toBe("failed");
    expect(client.remote["I_1:status"]).toBe("a0000001");
  });

  it("stale edit raises a conflict and does not write", async () => {
    const client = fakeClient({ "I_1:status": "CHANGED-ELSEWHERE" });
    const audit: AuditRecord[] = [];
    const e = entry();
    await processEntry(e, client, audit, "a0000006");
    expect(e.status).toBe("conflict");
    expect(client.log).toEqual([]);
  });

  it("concurrent different-label edits both survive", async () => {
    const client = fakeClient({ "I_1:labels": ["UI"] });
    const audit: AuditRecord[] = [];
    await processEntry(entry({ id: "a", field: "labels", base: ["UI"], next: { added: ["dashboard"], removed: [] }, idempotencyKey: "ka" }), client, audit, "x");
    await processEntry(entry({ id: "b", field: "labels", base: ["UI"], next: { added: ["design needed"], removed: [] }, idempotencyKey: "kb" }), client, audit, "x");
    expect([...(client.remote["I_1:labels"] as string[])].sort()).toEqual(["UI", "dashboard", "design needed"]);
  });

  it("closing sets Status done; reopening leaves Status unchanged", async () => {
    const client = fakeClient({ "I_1:state": "open", "I_1:status": "a0000002" });
    const audit: AuditRecord[] = [];
    await processEntry(entry({ op: "close", field: null, base: "open", next: "closed" }), client, audit, "DONE_OPT");
    expect(client.remote["I_1:state"]).toBe("closed");
    expect(client.remote["I_1:status"]).toBe("DONE_OPT");
    await processEntry(entry({ id: "r", op: "reopen", field: null, base: "closed", next: "open", idempotencyKey: "kr" }), client, audit, "DONE_OPT");
    expect(client.remote["I_1:state"]).toBe("open");
    expect(client.remote["I_1:status"]).toBe("DONE_OPT");
  });
});

describe("write-back hardening (regression)", () => {
  it("does not retry a permission 403, but does retry a throttled one", () => {
    // Regression: every 403 was treated as retryable, so a missing scope burnt
    // three attempts and the same rate limit.
    const permissionDenied = Object.assign(new Error("Resource not accessible"), {
      status: 403,
      response: { headers: { "x-ratelimit-remaining": "4999" } },
    });
    expect(isRetryable(permissionDenied)).toBe(false);

    const throttled = Object.assign(new Error("API rate limit exceeded"), {
      status: 403,
      response: { headers: { "x-ratelimit-remaining": "0" } },
    });
    expect(isRetryable(throttled)).toBe(true);

    expect(isRetryable(Object.assign(new Error("boom"), { status: 500 }))).toBe(true);
    expect(isRetryable(Object.assign(new Error("bad"), { status: 422 }))).toBe(false);
  });

  it("does not retry a GraphQL error, unless it is a rate limit", () => {
    // Regression: a GraphQL error has no HTTP status, so it read as a network
    // blip and a type mismatch was retried three times before failing.
    const gql = (type?: string) =>
      Object.assign(new Error("Request failed due to following response errors"), { name: "GraphqlResponseError", errors: [{ type, message: "x" }] });
    expect(isRetryable(gql())).toBe(false);
    expect(isRetryable(gql("NOT_FOUND"))).toBe(false);
    expect(isRetryable(gql("FORBIDDEN"))).toBe(false);
    expect(isRetryable(gql("RATE_LIMITED"))).toBe(true);
    // A connection reset still has no status and no GraphQL errors: retried.
    expect(isRetryable(new Error("socket hang up"))).toBe(true);
  });

  it("refuses to close when the issue state changed underneath", async () => {
    const client = fakeClient({ "I_1:state": "closed", "I_1:status": "a0000002" });
    const audit: AuditRecord[] = [];
    const e = entry({ op: "close", field: null, base: "open", next: "closed" });
    await processEntry(e, client, audit, "DONE_OPT");
    expect(e.status).toBe("conflict");
    expect(client.log).toEqual([]); // nothing was written
  });

  it("retries a transient failure on close and records the audit row", async () => {
    let calls = 0;
    const client: WriteClient & { log: string[] } = {
      log: [],
      async readField() {
        return "open";
      },
      async closeIssue() {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("boom"), { status: 502 });
        client.log.push("closed");
      },
      async applyField(_n, _f, next) {
        client.log.push(`status=${next}`);
      },
      async reopenIssue() {},
    };
    const audit: AuditRecord[] = [];
    const e = entry({ op: "close", field: null, base: "open", next: "closed" });
    await processEntry(e, client, audit, "DONE_OPT");
    expect(e.status).toBe("done");
    expect(calls).toBe(2);
    expect(client.log).toEqual(["closed", "status=DONE_OPT"]);
    expect(audit.at(-1)?.result).toBe("done");
  });

  it("a close whose Status write failed resumes at Status instead of reporting a conflict (v5 2.2)", async () => {
    const remote = { state: "open", status: "a0000001" };
    const log: string[] = [];
    let statusFailures = 1;
    const client: WriteClient = {
      async readField(_n, field) {
        return field === "state" ? remote.state : remote.status;
      },
      async closeIssue() {
        remote.state = "closed";
        log.push("close");
      },
      async applyField(_n, _f, next) {
        if (statusFailures-- > 0) throw Object.assign(new Error("boom"), { status: 502 });
        remote.status = String(next);
        log.push(`status=${next}`);
      },
      async reopenIssue() {
        remote.state = "open";
        log.push("reopen");
      },
    };
    const e = entry({ op: "close", field: null, base: "open", next: "closed" });
    await processEntry(e, client, [], "DONE_OPT");
    expect(e.status).toBe("done");
    expect(log).toEqual(["close", "status=DONE_OPT"]); // closed once, not twice
    expect(remote).toEqual({ state: "closed", status: "DONE_OPT" });
  });

  it("a reopen that an earlier try already applied is done, not a conflict (v5 2.2)", async () => {
    const client = fakeClient({ "I_1:state": "open" });
    const e = entry({ op: "reopen", field: null, base: "closed", next: "open", attempts: 1 });
    await processEntry(e, client, [], "DONE_OPT");
    expect(e.status).toBe("done");
    expect(client.log).toEqual([]);
  });

  it("an unreadable state fails a close instead of reporting a conflict", async () => {
    const client: WriteClient = {
      async readField() {
        throw Object.assign(new Error("bad gateway"), { status: 502 });
      },
      async applyField() {},
      async closeIssue() {
        throw new Error("must not write");
      },
      async reopenIssue() {},
    };
    const e = entry({ op: "close", field: null, base: "open", next: "closed" });
    await processEntry(e, client, [], "DONE_OPT");
    expect(e.status).toBe("failed");
  });

  it("never lets a throw escape processEntry", async () => {
    const client: WriteClient = {
      async readField() {
        throw new Error("network down");
      },
      async applyField() {},
      async closeIssue() {},
      async reopenIssue() {},
      async createIssue() {
        return { nodeId: "I_new", number: 999 };
      },
      async addProjectItem() {},
    };
    const audit: AuditRecord[] = [];
    const e = entry();
    await expect(processEntry(e, client, audit, "X")).resolves.toBeUndefined();
    expect(e.status).toBe("failed");
    expect(audit.at(-1)?.result).toBe("failed");
  });
});
