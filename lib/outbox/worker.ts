import type { OutboxEntry, OutboxStatus } from "./queue";
import { closeSequence } from "./mutations";

export type AuditRecord = {
  userId: string;
  issueNodeId: string;
  field: string | null;
  old: unknown;
  next: unknown;
  result: string;
};

/** Minimal GitHub surface the worker needs (real Octokit in prod, fake in tests). */
export interface WriteClient {
  readField(issueNodeId: string, field: string | null): Promise<unknown>;
  applyField(issueNodeId: string, field: string | null, next: unknown): Promise<void>;
  closeIssue(issueNodeId: string): Promise<void>;
  reopenIssue(issueNodeId: string): Promise<void>;
}

/**
 * A failure that trying again cannot fix (the issue now lives in another repo,
 * the project is not the pinned one). `isRetryable` never retries it, and its
 * message reaches the user and the audit log as written.
 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export function isRetryable(e: unknown): boolean {
  if (e instanceof NonRetryableError) return false;
  const status = (e as { status?: number })?.status ?? 0;
  if (status >= 500 || status === 429) return true;
  // No HTTP status at all: a connection reset, DNS failure or timeout. Those
  // are transient, so retry rather than fail the edit permanently.
  if (status === 0) return true;
  if (status === 403) {
    // GitHub returns 403 for rate limits *and* for real permission problems.
    // Retrying a missing-scope or insufficient-permission 403 three times only
    // burns rate limit, so only retry when the response looks like throttling.
    const headers = ((e as { response?: { headers?: Record<string, unknown> } })?.response
      ?.headers ?? {}) as Record<string, unknown>;
    return (
      headers["retry-after"] != null ||
      headers["x-ratelimit-remaining"] === "0" ||
      /rate limit|secondary rate/i.test(String((e as { message?: string })?.message ?? ""))
    );
  }
  return false;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What one try at an entry came to (W1). `retry`: a transient failure, try later. */
export type Attempt = {
  status: Exclude<OutboxStatus, "pending"> | "retry";
  error: string | null;
  /** GitHub's value, on a conflict. */
  remote?: unknown;
  /** Whether a write was sent (counts as an attempt). */
  tried: boolean;
};

/**
 * Attempts per entry, the first included. Four tries means three retries, so
 * BACKOFF_MS' three delays (2 s, 8 s, 30 s) are all used (W1).
 */
export const MAX_ATTEMPTS = 4;

/**
 * One try at an entry: field-level stale check against a fresh read, then
 * apply. A conflict aborts without writing and reports GitHub's value. A
 * retryable failure (5xx, 429, throttled 403) reports `retry` while attempts
 * remain; the durable outbox schedules the next try instead of sleeping in
 * the request. A throw never escapes: the caller's HTTP response would
 * otherwise become an unhandled 500.
 *
 * `entry.attempts` counts tries already made; this one is `attempts + 1`.
 */
export async function attemptEntry(entry: OutboxEntry, client: WriteClient, doneStatusOptionId: string): Promise<Attempt> {
  const isState = entry.op === "close" || entry.op === "reopen";
  // Label/assignee deltas commute: concurrent edits to *different* labels
  // never conflict, so deltas skip the full-set stale check.
  const isDelta = entry.next != null && typeof entry.next === "object" && "added" in (entry.next as Record<string, unknown>);
  let current: unknown;
  try {
    current = await client.readField(entry.issueNodeId, isState ? "state" : entry.field);
  } catch (e) {
    // A failed read is not evidence of a remote change: reporting it as a
    // conflict offered "Overwrite" for an edit nobody else had made. A transient
    // read failure is retried like a transient write; a permanent one fails.
    if (isRetryable(e) && entry.attempts + 1 < MAX_ATTEMPTS) return { status: "retry", error: String(e), tried: true };
    return { status: "failed", error: e instanceof NonRetryableError ? e.message : "could not read current value from GitHub", tried: false };
  }
  // A close or reopen that an earlier try already applied (it closed the issue,
  // then the Status write failed or the run was cut off): GitHub holds the
  // target state, so resume at the next step rather than report the user's own
  // change as a conflict (v5 2.2).
  if (isState && entry.attempts > 0) {
    const target = entry.op === "close" ? "closed" : "open";
    if (current === target) {
      try {
        if (entry.op === "close") await client.applyField(entry.issueNodeId, "status", doneStatusOptionId);
        return { status: "done", error: null, tried: true };
      } catch (e) {
        const tries = entry.attempts + 1;
        if (isRetryable(e) && tries < MAX_ATTEMPTS) return { status: "retry", error: String(e), tried: true };
        return { status: "failed", error: String(e), tried: true };
      }
    }
  }
  // A previous try may have applied the change and failed afterwards (a timeout
  // or a 502 after GitHub committed): if GitHub already holds the target value,
  // the edit is done, not a conflict with the user's own write. (State ops are
  // left to the stale check: a close that "already happened" is reported as a
  // conflict, the SPEC §5 behaviour.)
  if (entry.op === "update" && !isDelta && same(current, entry.next)) return { status: "done", error: null, tried: true };
  const expected = isState ? (entry.base ?? null) : entry.base;
  const stale = isState ? expected != null && !same(current, expected) : !isDelta && !same(current, expected);
  if (stale) return { status: "conflict", error: "Changed on GitHub — review before overwriting", remote: current, tried: false };
  try {
    if (entry.op === "close") {
      // SPEC §5: close first, then move Status to Done so the board agrees
      // with the issue state.
      for (const step of closeSequence()) {
        if (step === "close-issue") await client.closeIssue(entry.issueNodeId);
        else await client.applyField(entry.issueNodeId, "status", doneStatusOptionId);
      }
    } else if (entry.op === "reopen") {
      await client.reopenIssue(entry.issueNodeId);
    } else {
      await client.applyField(entry.issueNodeId, entry.field, entry.next);
    }
    return { status: "done", error: null, tried: true };
  } catch (e) {
    const tries = entry.attempts + 1;
    if (isRetryable(e) && tries < MAX_ATTEMPTS) return { status: "retry", error: String(e), tried: true };
    return { status: "failed", error: String(e), tried: true };
  }
}

/**
 * Process an entry to the end in-process, retrying transient failures with
 * `sleep` between tries, and record the result in `audit`. The durable outbox
 * (lib/outbox/store.ts) drives attemptEntry itself with stored backoff; this
 * stays for callers without a database (tests).
 */
export async function processEntry(
  entry: OutboxEntry,
  client: WriteClient,
  audit: AuditRecord[],
  doneStatusOptionId: string,
  sleep = (_ms: number) => Promise.resolve(),
): Promise<void> {
  for (;;) {
    const r = await attemptEntry(entry, client, doneStatusOptionId);
    if (r.tried) entry.attempts += 1;
    if (r.status === "retry") {
      await sleep(BACKOFF_MS[entry.attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!);
      continue;
    }
    entry.status = r.status;
    entry.error = r.error;
    audit.push({ userId: entry.userId, issueNodeId: entry.issueNodeId, field: entry.field, old: entry.base, next: entry.next, result: r.status });
    return;
  }
}

/** Delay before the retries (W1). */
export const BACKOFF_MS = [2_000, 8_000, 30_000];
