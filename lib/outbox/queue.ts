export type OutboxOp = "update" | "close" | "reopen" | "create";

/**
 * `pending`: not sent yet (or waiting for a retry); `sending`: claimed by the
 * one process that is writing it (W0); then the outcome. A crash leaves `sending`;
 * the next start recovers it.
 */
export type OutboxStatus = "pending" | "sending" | "done" | "failed" | "conflict";

export type OutboxEntry = {
  id: string;
  userId: string;
  issueNodeId: string;
  op: OutboxOp;
  field: string | null;
  idempotencyKey: string;
  base: unknown;
  next: unknown;
  /** For a multi-step job: the last step that finished (W0). */
  step?: string | null;
  /** A create job's confirmed issue, so a resumed job does not create a second one (W3). */
  result?: unknown;
  status: OutboxStatus;
  attempts: number;
  error: string | null;
  /** When the job was queued (ISO). A retried create looks for issues made since then (W3). */
  createdAt?: string;
};

/** Bulk edits over 50 issues need a confirmation dialog (SPEC §4.8). */
export function needsBulkConfirm(count: number): boolean {
  return count > 50;
}
