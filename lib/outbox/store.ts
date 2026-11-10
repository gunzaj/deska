// The outbox (SPEC §4.8, W0): one process, one local user, one queue.
//
// - enqueue inserts a row keyed by its idempotency key (one per user action);
//   a repeat of the same action returns the existing row;
// - the edit request processes its own row right away (fast path), and a small
//   in-process loop drains what is left (retries, and rows a crash left behind);
// - a row is claimed by moving it to `sending` in a short transaction, so the
//   fast path and the drain can never write the same row twice. A crash leaves
//   the row `sending`; the next start resets it to `pending` (W0: one process,
//   so no lease or fencing token is needed);
// - the GitHub read and write happen OUTSIDE any transaction: the claim and the
//   result are short transactions, so a slow GitHub call never holds a row lock;
// - a transient failure schedules the next try (2 s, 8 s, 30 s) through
//   next_attempt_at instead of sleeping in the request;
// - a multi-step job (close = close the issue, then set Status) records the step
//   it finished, so a crash between the two resumes at the second one instead of
//   closing again or reporting the user's own close as a conflict;
// - every finished row writes an audit_log row; a done write is re-read from
//   GitHub into the cache by the caller-supplied `refresh`.
import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLog, outbox } from "@/db/schema";
import { LOCAL_OWNER } from "@/lib/local-owner";
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
  /** For a multi-step job: the last step that finished (W0). */
  step: string | null;
  /** A create job's confirmed issue (node ID and number), for a resumed W3 job. */
  result: unknown;
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
  /** Re-read the issue into the cache after a successful write. */
  refresh?: (issueNodeId: string) => Promise<void>;
  /** Persist a finished step of a multi-step job before the next one starts (W0). */
  recordStep?: (id: string, step: string, result?: unknown) => Promise<void>;
};

type Raw = typeof outbox.$inferSelect;
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

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
    step: r.step ?? null,
    result: r.resultJson ?? null,
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

/** The local user's edits that aren't done: pending, sending, failed and conflicts, newest first. */
export async function listOpenEdits(limit = 100): Promise<OutboxRow[]> {
  const rows = await getDb()
    .select()
    .from(outbox)
    .where(sql`${outbox.status} <> 'done'`)
    .orderBy(desc(outbox.createdAt))
    .limit(limit);
  return rows.map(toRow);
}

const due = or(sql`${outbox.nextAttemptAt} IS NULL`, lte(outbox.nextAttemptAt, sql`now()`))!;

/**
 * A row is claimable only when no older unfinished row exists for the same issue
 * and field (v5 1.6): "remove X" must not take the fast path while an older
 * "add X" waits on backoff, or the retry would bring X back. Label and assignee
 * deltas skip the stale check, so order is all that protects them.
 */
const unblocked = sql`NOT EXISTS (
  SELECT 1 FROM outbox o2
  WHERE o2.issue_node_id = ${outbox.issueNodeId}
    AND o2.field IS NOT DISTINCT FROM ${outbox.field}
    AND o2.status IN ('pending', 'sending')
    AND (o2.created_at, o2.id) < (${outbox.createdAt}, ${outbox.id})
)`;

/** The claim: pending -> sending, in one statement, so exactly one caller gets the row. */
async function claim(id: string): Promise<Raw | null> {
  const [row] = await getDb()
    .update(outbox)
    .set({ status: "sending", updatedAt: new Date() })
    .where(and(eq(outbox.id, id), eq(outbox.status, "pending"), due, unblocked))
    .returning();
  return row ?? null;
}

/**
 * A crash between the two steps of a close leaves its row `sending`; the next
 * start turns it back into a pending row. Its `step` says where to resume, so the
 * close is not sent twice and the Status update is not skipped.
 */
export async function recoverSending(): Promise<number> {
  const rows = await getDb().update(outbox).set({ status: "pending" }).where(eq(outbox.status, "sending")).returning({ id: outbox.id });
  return rows.length;
}

/** Persist a finished step of a multi-step job, before the next step starts (W0). */
export async function saveStep(id: string, step: string, result?: unknown): Promise<void> {
  await getDb()
    .update(outbox)
    .set({ step, ...(result === undefined ? {} : { resultJson: result as never }), updatedAt: new Date() })
    .where(and(eq(outbox.id, id), eq(outbox.status, "sending")));
}

/**
 * Record the outcome of one try: status, attempts, backoff, remote value and the
 * audit row. `status` is still `sending` (the claim's), so a row recovered by a
 * restart cannot be recorded over by the crashed run's late answer.
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
      updatedAt: new Date(),
    })
    .where(and(eq(outbox.id, row.id), eq(outbox.status, "sending")))
    .returning();
  if (!saved) {
    // A restarted process recovered the row and another run has it now: drop this result.
    console.warn(`outbox: dropped the result for ${row.id}; the row was recovered (${r.status})`);
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
    {
      id: row.id,
      userId: row.userId,
      issueNodeId: row.issueNodeId,
      op: row.op,
      field: row.field,
      idempotencyKey: row.idempotencyKey,
      base: row.base,
      next: row.next,
      step: row.step,
      result: row.result,
      status: row.status,
      attempts: row.attempts,
      error: row.error,
    },
    deps.client,
    deps.doneStatusOptionId,
    deps.recordStep ? (step, result) => deps.recordStep!(row.id, step, result) : undefined,
  );
  return getDb().transaction((tx) => recordAttempt(tx, raw, r));
}

/**
 * After a write, and after a conflict (SPEC §4.8: "the issue is re-read and
 * GitHub's resulting state shown"), re-read the issue so Deska shows what GitHub
 * holds now.
 */
async function afterDone(row: OutboxRow, deps: ProcessDeps) {
  if ((row.status !== "done" && row.status !== "conflict") || !deps.refresh) return;
  // A failed re-read only delays the cache until the next sync cycle.
  await deps.refresh(row.issueNodeId).catch((e) => console.error(`outbox: cache refresh failed for ${row.issueNodeId}: ${String(e)}`));
}

/**
 * The fast path: the edit request processes its own row now. If another run holds
 * the row or already finished it, the current state is returned.
 */
export async function processEdit(id: string, deps: ProcessDeps): Promise<OutboxRow | null> {
  const claimed = await claim(id);
  if (!claimed) return getEdit(id);
  const out = await runAttempt(claimed, deps);
  if (!out) return getEdit(id);
  await afterDone(out, deps);
  await processFollowers(out, deps);
  return out;
}

/**
 * Once a row is finished, run the rows queued behind it for the same issue and
 * field, oldest first (v5 1.6). Without this, a queued row would sit until the
 * drain loop finds it.
 */
async function processFollowers(finished: OutboxRow, deps: ProcessDeps, limit = 10): Promise<OutboxRow[]> {
  const out: OutboxRow[] = [];
  let previous = finished;
  for (let i = 0; i < limit && previous.status !== "pending"; i++) {
    const [next] = await getDb()
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.issueNodeId, finished.issueNodeId),
          finished.field === null ? isNull(outbox.field) : eq(outbox.field, finished.field),
          eq(outbox.status, "pending"),
          due,
          unblocked,
        ),
      )
      .orderBy(asc(outbox.createdAt), asc(outbox.id))
      .limit(1);
    if (!next) break;
    const claimed = await claim(next.id);
    if (!claimed) break;
    const row = await runAttempt(claimed, deps);
    if (!row) break;
    await afterDone(row, deps);
    out.push(row);
    previous = row;
  }
  return out;
}

export type DrainOptions = {
  limit?: number;
  /** Epoch ms after which no new row is started. A row already running finishes. */
  deadline?: number;
};

/**
 * Drain pending rows: retries that are due, and rows a crash left behind. The
 * in-process worker loop (lib/outbox/worker-loop.ts) calls this every few
 * seconds. `depsFor` returns null when there is no token: the row fails.
 */
export async function drainOutbox(depsFor: () => Promise<ProcessDeps | null>, opts: DrainOptions = {}): Promise<{ processed: OutboxRow[] }> {
  const processed: OutboxRow[] = [];
  for (let i = 0; i < (opts.limit ?? 50); i++) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;
    const [candidate] = await getDb()
      .select()
      .from(outbox)
      .where(and(eq(outbox.status, "pending"), due, unblocked))
      .orderBy(asc(outbox.createdAt), asc(outbox.id))
      .limit(1);
    if (!candidate) break;
    const claimed = await claim(candidate.id);
    if (!claimed) continue;
    const deps = await depsFor();
    if (!deps) {
      const row = await getDb().transaction(async (tx) => {
        const [saved] = await tx
          .update(outbox)
          .set({ status: "failed", error: "no GitHub token; connect GitHub again and retry", updatedAt: new Date() })
          .where(and(eq(outbox.id, claimed.id), eq(outbox.status, "sending")))
          .returning();
        if (!saved) return null;
        await tx.insert(auditLog).values({
          userId: LOCAL_OWNER,
          issueNodeId: claimed.issueNodeId ?? "",
          field: claimed.field ?? claimed.op,
          old: (claimed.baseJson ?? null) as never,
          new: (claimed.newJson ?? null) as never,
          result: "failed",
        });
        return toRow(saved);
      });
      if (row) processed.push(row);
      continue;
    }
    const row = await runAttempt(claimed, deps);
    if (!row) continue;
    processed.push(row);
    await afterDone(row, deps);
    processed.push(...(await processFollowers(row, deps)));
  }
  return { processed };
}
