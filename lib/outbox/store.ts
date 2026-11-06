// Durable outbox (IMPROVEMENTS W1, SPEC §5). Edits used to live in a
// process-local array: a restart or the end of a serverless invocation lost
// them, and retries slept inside the request. Now:
//
// - enqueue inserts a row keyed by its idempotency key (one per user action);
//   a repeat of the same action returns the existing row;
// - the edit request processes its own row right away (fast path), and the
//   in-process worker loop drains what is left;
// - a row is claimed by leasing it (`next_attempt_at`), so two drains never take
//   the same row and a crashed process's lease expires and the row is retried;
// - the GitHub read and write happen OUTSIDE any transaction: the claim and the
//   result are short transactions, so a slow GitHub call never holds a pooled
//   connection or a row lock (a handful of slow edits used to exhaust the pool);
// - a transient failure schedules the next try (2 s, 8 s, 30 s) through
//   next_attempt_at instead of sleeping;
// - every finished row writes an audit_log row; a done write is re-read from
//   GitHub into the cache by the caller-supplied `refresh`.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog, outbox } from "@/db/schema";
import { bumpGenerationOnce } from "@/lib/sync/generation";
import type { OutboxOp, OutboxStatus } from "./queue";
import { attemptEntry, BACKOFF_MS, type Attempt, type WriteClient } from "./worker";

export type OutboxRow = {
  id: string;
  userId: string;
  issueNodeId: string;
  op: OutboxOp;
  field: string | null;
  idempotencyKey: string;
  base: unknown;
  next: unknown;
  /** GitHub's value when the edit hit a conflict. */
  remote: unknown;
  status: OutboxStatus;
  attempts: number;
  error: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewEdit = {
  userId: string;
  issueNodeId: string;
  op: OutboxOp;
  field: string | null;
  base: unknown;
  next: unknown;
  /** Unique per user action; a retried request with the same key is the same edit. */
  idempotencyKey: string;
};

export type ProcessDeps = {
  client: WriteClient;
  doneStatusOptionId: string;
  /** Re-read the issue into the cache after a successful write (acting user's token). */
  refresh?: (issueNodeId: string) => Promise<void>;
};

type Raw = typeof outbox.$inferSelect;
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * How long a claimed row stays invisible to other drains before it is assumed
 * the claimer died. Long enough for a slow GitHub call, short enough to retry
 * soon. Overridable for tests.
 */
export const LEASE_MS = Number(process.env.OUTBOX_LEASE_MS ?? 120_000);
const leaseUntil = () => new Date(Date.now() + LEASE_MS);
/**
 * What a claim writes: the lease deadline and a fresh fencing token (v5 1.5).
 * A row that still carries a token was claimed before and never recorded (the
 * run outlived its lease or died), so that unfinished try counts as an attempt:
 * the new run then resumes a half-done close instead of calling its own,
 * already-applied change a conflict (v5 2.2).
 */
const claim = () => ({
  nextAttemptAt: leaseUntil(),
  leaseToken: randomUUID(),
  attempts: sql`CASE WHEN ${outbox.leaseToken} IS NOT NULL THEN ${outbox.attempts} + 1 ELSE ${outbox.attempts} END`,
});

function toRow(r: Raw): OutboxRow {
  return {
    id: r.id,
    userId: r.userId ?? "",
    issueNodeId: r.issueNodeId ?? "",
    op: r.op as OutboxOp,
    field: r.field,
    idempotencyKey: r.idempotencyKey ?? "",
    base: r.baseJson ?? null,
    next: r.newJson ?? null,
    remote: r.remoteJson ?? null,
    status: r.status as OutboxStatus,
    attempts: r.attempts,
    error: r.error,
    nextAttemptAt: r.nextAttemptAt?.toISOString() ?? null,
    createdAt: (r.createdAt ?? new Date(0)).toISOString(),
    updatedAt: (r.updatedAt ?? r.createdAt ?? new Date(0)).toISOString(),
  };
}

/** Insert the edit, or return the row an earlier request with the same key made. */
export async function enqueueEdit(e: NewEdit): Promise<OutboxRow> {
  const db = getDb();
  // ON CONFLICT DO UPDATE (not DO NOTHING) always returns the row, so a
  // concurrent insert can never leave the follow-up SELECT empty.
  const rows = await db
    .insert(outbox)
    .values({
      userId: e.userId,
      issueNodeId: e.issueNodeId,
      op: e.op,
      field: e.field,
      idempotencyKey: e.idempotencyKey,
      baseJson: e.base === undefined ? null : (e.base as never),
      newJson: e.next === undefined ? null : (e.next as never),
      status: "pending",
    })
    .onConflictDoUpdate({ target: outbox.idempotencyKey, set: { idempotencyKey: e.idempotencyKey } })
    .returning();
  return toRow(rows[0]!);
}

export async function getEdit(id: string): Promise<OutboxRow | null> {
  const [r] = await getDb().select().from(outbox).where(eq(outbox.id, id)).limit(1);
  return r ? toRow(r) : null;
}

/** The viewer's edits that aren't done: pending, failed and conflicts, newest first. */
export async function listOpenEdits(userId: string, limit = 100): Promise<OutboxRow[]> {
  const rows = await getDb()
    .select()
    .from(outbox)
    .where(and(eq(outbox.userId, userId), ne(outbox.status, "done")))
    .orderBy(desc(outbox.createdAt))
    .limit(limit);
  return rows.map(toRow);
}

const due = or(sql`${outbox.nextAttemptAt} IS NULL`, lte(outbox.nextAttemptAt, sql`now()`))!;

/**
 * A row is claimable only when no older unfinished row exists for the same
 * issue and field (v5 1.6). Without this, "remove X" took the fast path while
 * an older "add X" waited on backoff, and the retry then brought X back.
 * Label and assignee deltas skip the stale check, so order is all that protects them.
 */
const unblocked = sql`NOT EXISTS (
  SELECT 1 FROM outbox o2
  WHERE o2.issue_node_id = ${outbox.issueNodeId}
    AND o2.field IS NOT DISTINCT FROM ${outbox.field}
    AND o2.status = 'pending'
    AND (o2.created_at, o2.id) < (${outbox.createdAt}, ${outbox.id})
)`;

/**
 * Record the outcome of one try: status, attempts, backoff, remote value, audit
 * row. Fenced by the claim's lease token: when another drain took the row over
 * after this run's lease expired, nothing matches and the result is dropped
 * (null), so a slow first run can never overwrite the second run's outcome.
 */
export async function recordAttempt(tx: Tx, raw: Raw, r: Attempt): Promise<OutboxRow | null> {
  const row = toRow(raw);
  const attempts = row.attempts + (r.tried ? 1 : 0);
  const status: OutboxStatus = r.status === "retry" ? "pending" : r.status;
  const nextAttemptAt = r.status === "retry" ? new Date(Date.now() + (BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!)) : null;
  const [saved] = await tx
    .update(outbox)
    .set({
      status,
      attempts,
      error: r.error,
      remoteJson: r.status === "conflict" ? ((r.remote ?? null) as never) : null,
      nextAttemptAt,
      leaseToken: null,
      updatedAt: new Date(),
    })
    .where(and(eq(outbox.id, row.id), raw.leaseToken ? eq(outbox.leaseToken, raw.leaseToken) : sql`false`))
    .returning();
  if (!saved) {
    console.warn(`outbox: dropped the result for ${row.id}; its lease was taken over (${r.status})`);
    return null;
  }
  if (status !== "pending") {
    await tx.insert(auditLog).values({
      userId: row.userId,
      issueNodeId: row.issueNodeId,
      field: row.field ?? row.op,
      old: (row.base ?? null) as never,
      new: (row.next ?? null) as never,
      result: status,
    });
  }
  return toRow(saved);
}

/**
 * One try at an already-claimed row. The GitHub read and write run with no
 * transaction open; only recording the result touches the database. A throw never
 * escapes `attemptEntry`, so the caller's HTTP response cannot become a 500.
 */
async function runAttempt(raw: Raw, deps: ProcessDeps): Promise<OutboxRow | null> {
  const row = toRow(raw);
  const r = await attemptEntry(
    { id: row.id, userId: row.userId, issueNodeId: row.issueNodeId, op: row.op, field: row.field, idempotencyKey: row.idempotencyKey, base: row.base, next: row.next, status: row.status, attempts: row.attempts, error: row.error },
    deps.client,
    deps.doneStatusOptionId,
  );
  return getDb().transaction((tx) => recordAttempt(tx, raw, r));
}

/**
 * After a write, and after a conflict (SPEC §5: "the cache is refreshed"),
 * re-read the issue so Deska shows what GitHub holds now.
 */
async function afterDone(row: OutboxRow, deps: ProcessDeps) {
  if ((row.status !== "done" && row.status !== "conflict") || !deps.refresh) return;
  // A failed re-read only delays the cache until the next sync cycle.
  await deps.refresh(row.issueNodeId).catch((e) => console.error(`outbox: cache refresh failed for ${row.issueNodeId}: ${String(e)}`));
}

/**
 * The fast path: the edit request processes its own row now. The row is claimed
 * by a short transaction that leases it; the GitHub call runs outside. If another
 * process holds the row or already finished it, the current state is returned.
 */
export async function processEdit(id: string, deps: ProcessDeps): Promise<OutboxRow | null> {
  const db = getDb();
  const claimed = await db.transaction(async (tx) => {
    const [held] = await tx
      .update(outbox)
      .set(claim())
      .where(and(eq(outbox.id, id), eq(outbox.status, "pending"), due, unblocked))
      .returning();
    if (held) return { row: held, mine: true } as const;
    const [now] = await tx.select().from(outbox).where(eq(outbox.id, id)).limit(1);
    return now ? ({ row: now, mine: false } as const) : null;
  });
  if (!claimed) return null;
  if (!claimed.mine) return toRow(claimed.row);
  const out = await runAttempt(claimed.row, deps);
  // Fenced out: the row now belongs to another run; report what it holds.
  if (!out) return getEdit(id);
  await afterDone(out, deps);
  await processFollowers(out, deps);
  return out;
}

/**
 * Once a row is finished, run the same user's rows queued behind it for the
 * same issue and field, oldest first (v5 1.6). A row waiting for an older one
 * would otherwise sit until the next drain finds it old enough.
 */
async function processFollowers(finished: OutboxRow, deps: ProcessDeps, limit = 10, deadline?: number): Promise<OutboxRow[]> {
  const out: OutboxRow[] = [];
  let previous = finished;
  for (let i = 0; i < limit && previous.status !== "pending"; i++) {
    if (deadline !== undefined && Date.now() >= deadline) break;
    const claimed = await getDb().transaction(async (tx) => {
      const [next] = await tx
        .select()
        .from(outbox)
        .where(
          and(
            eq(outbox.userId, finished.userId),
            eq(outbox.issueNodeId, finished.issueNodeId),
            finished.field === null ? isNull(outbox.field) : eq(outbox.field, finished.field),
            eq(outbox.status, "pending"),
            due,
            unblocked,
          ),
        )
        .orderBy(asc(outbox.createdAt), asc(outbox.id))
        .for("update", { skipLocked: true })
        .limit(1);
      if (!next) return null;
      const [leased] = await tx.update(outbox).set(claim()).where(eq(outbox.id, next.id)).returning();
      return leased!;
    });
    if (!claimed) break;
    const row = await runAttempt(claimed, deps);
    if (!row) break;
    await afterDone(row, deps);
    out.push(row);
    previous = row;
  }
  return out;
}

/** Pending rows the fast path should have handled by now. */
export const LEFTOVER_AGE_MS = 60_000;

/**
 * Drain leftovers: pending rows that are due and either older than
 * `olderThanMs` (their request ended before processing them) or scheduled for a
 * retry. Each row is claimed by a short transaction that leases it; the GitHub
 * call runs outside. `depsFor` returns null when there is no stored token for the
 * user: the row fails.
 */
export type DrainOptions = {
  olderThanMs?: number;
  limit?: number;
  /** Epoch ms after which no new row is started. A row already running finishes. */
  deadline?: number;
};

export async function drainOutbox(
  depsFor: (userId: string) => Promise<ProcessDeps | null>,
  opts: DrainOptions = {},
): Promise<{ processed: OutboxRow[] }> {
  return bumpGenerationOnce(() => drain(depsFor, opts));
}

async function drain(
  depsFor: (userId: string) => Promise<ProcessDeps | null>,
  opts: DrainOptions,
): Promise<{ processed: OutboxRow[] }> {
  const db = getDb();
  const olderThan = new Date(Date.now() - (opts.olderThanMs ?? LEFTOVER_AGE_MS));
  const processed: OutboxRow[] = [];
  for (let i = 0; i < (opts.limit ?? 50); i++) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;
    const claimed = await db.transaction(async (tx): Promise<Raw | null> => {
      const [held] = await tx
        .select()
        .from(outbox)
        .where(
          and(
            eq(outbox.status, "pending"),
            due,
            unblocked,
            or(lte(outbox.createdAt, olderThan), isNotNull(outbox.nextAttemptAt)),
          ),
        )
        .orderBy(asc(outbox.createdAt), asc(outbox.id))
        .for("update", { skipLocked: true })
        .limit(1);
      if (!held) return null;
      const [leased] = await tx.update(outbox).set(claim()).where(eq(outbox.id, held.id)).returning();
      return leased!;
    });
    if (!claimed) break;
    const userId = claimed.userId ?? "";
    // A user's rows run one after another inside this loop, so no two of their
    // writes go out together; skipping the user until the next drain made a
    // backlog take one tick per row (v5 2.3).
    const deps = await depsFor(userId);
    if (!deps) {
      const row = await db.transaction(async (tx) => {
        const [saved] = await tx
          .update(outbox)
          .set({ status: "failed", error: "no GitHub token; connect GitHub again and retry", leaseToken: null, updatedAt: new Date() })
          .where(and(eq(outbox.id, claimed.id), claimed.leaseToken ? eq(outbox.leaseToken, claimed.leaseToken) : sql`false`))
          .returning();
        if (!saved) return null;
        await tx.insert(auditLog).values({ userId, issueNodeId: claimed.issueNodeId ?? "", field: claimed.field ?? claimed.op, old: (claimed.baseJson ?? null) as never, new: (claimed.newJson ?? null) as never, result: "failed" });
        return toRow(saved);
      });
      if (row) processed.push(row);
      continue;
    }
    const row = await runAttempt(claimed, deps);
    if (!row) continue;
    processed.push(row);
    await afterDone(row, deps);
    processed.push(...(await processFollowers(row, deps, 10, opts.deadline)));
  }
  return { processed };
}
